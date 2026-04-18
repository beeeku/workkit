import type { Adapter, AdapterSendArgs, AdapterSendResult, WebhookEvent } from "../../types";
import { type AttachmentLoadOptions, type AttachmentSpec, loadAttachments } from "./attachments";
import { FromDomainError } from "./errors";
import { renderEmail } from "./render";
import {
	isComplaint,
	isHardBounce,
	parseResendEvents,
	safeParseJson,
	verifyResendSignature,
} from "./webhook";

export interface EmailPayload {
	[key: string]: unknown;
}

/**
 * Auto opt-out hook — called when a webhook event indicates a hard bounce
 * or a complaint. **Always invoked with `notificationId: null`** (global
 * opt-out for the channel) because Resend's webhook payload does not carry
 * the originating notification id. The hook receives the recipient email
 * address as `userId` — your implementation must resolve it to your
 * internal id (typically via your user table).
 */
export type EmailOptOutHook = (
	emailAddress: string,
	channel: "email",
	notificationId: null,
	reason: "hard-bounce" | "complaint",
) => Promise<void>;

interface R2BucketLike {
	get(key: string): Promise<{
		arrayBuffer: () => Promise<ArrayBuffer>;
		httpMetadata?: { contentType?: string };
	} | null>;
}

export interface EmailAdapterOptions {
	apiKey: string;
	from: string;
	replyTo?: string | string[];
	apiUrl?: string;
	bucket?: R2BucketLike;
	attachments?: AttachmentLoadOptions;
	webhook?: { maxAgeMs?: number };
	autoOptOut?: { enabled?: boolean; hook: EmailOptOutHook };
	/**
	 * Notification ids that should carry an explicit unsubscribe header
	 * (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`). Resend does not
	 * expose a public flag to disable open/click tracking, so the option
	 * was renamed from `disableTrackingFor` to reflect what it actually
	 * does. Callers wanting full tracking suppression should configure it
	 * in the Resend dashboard.
	 */
	markUnsubscribable?: ReadonlyArray<string>;
}

const DEFAULT_API_URL = "https://api.resend.com/emails";
const FROM_RE = /^(?:.+\s)?<?([^\s<>]+@[^\s<>]+)>?$/;

interface ResendSendBody {
	from: string;
	to: string[];
	subject: string;
	html: string;
	text: string;
	reply_to?: string | string[];
	attachments?: { filename: string; content: string; content_type: string }[];
	headers?: Record<string, string>;
}

interface ResendSendResponse {
	id?: string;
	error?: { message?: string; statusCode?: number };
}

export function emailAdapter(options: EmailAdapterOptions): Adapter<EmailPayload> {
	if (!FROM_RE.test(options.from)) throw new FromDomainError(options.from);
	const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
	const autoOptOutEnabled = options.autoOptOut?.enabled !== false;

	return {
		async send(args: AdapterSendArgs<EmailPayload>): Promise<AdapterSendResult> {
			const tpl = args.template as {
				template?: unknown;
				attachments?: (p: EmailPayload) => AttachmentSpec[];
				title?: (p: EmailPayload) => string;
				body?: (p: EmailPayload) => string;
			};
			const subject = tpl.title?.(args.payload) ?? "(no subject)";
			const renderInput = tpl.template ?? tpl.body?.(args.payload) ?? "";

			const { html, text } = await renderEmail({ template: renderInput });

			let attachments: ResendSendBody["attachments"] | undefined;
			if (tpl.attachments) {
				const specs = tpl.attachments(args.payload);
				if (!options.bucket) {
					return { status: "failed", error: "emailAdapter: bucket required for attachments" };
				}
				try {
					const blobs = await loadAttachments(options.bucket, specs, options.attachments);
					attachments = blobs.map((b) => ({
						filename: b.filename,
						content: bytesToBase64(b.bytes),
						content_type: b.contentType,
					}));
				} catch (err) {
					return { status: "failed", error: err instanceof Error ? err.message : String(err) };
				}
			}

			const body: ResendSendBody = {
				from: options.from,
				to: [args.address],
				subject,
				html,
				text,
				...(options.replyTo ? { reply_to: options.replyTo } : {}),
				...(attachments && attachments.length > 0 ? { attachments } : {}),
			};
			if ((options.markUnsubscribable ?? []).includes(args.notificationId)) {
				body.headers = {
					...(body.headers ?? {}),
					"X-Entity-Ref-ID": args.deliveryId,
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				};
			}

			let resp: Response;
			try {
				resp = await fetch(apiUrl, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${options.apiKey}`,
					},
					body: JSON.stringify(body),
				});
			} catch (err) {
				return { status: "failed", error: err instanceof Error ? err.message : String(err) };
			}

			let json: ResendSendResponse | null = null;
			try {
				json = (await resp.json()) as ResendSendResponse;
			} catch {
				json = null;
			}
			if (!resp.ok) {
				return {
					status: "failed",
					error: json?.error?.message ?? `resend HTTP ${resp.status} ${resp.statusText}`,
				};
			}
			if (!json?.id) {
				return { status: "failed", error: "resend response missing id" };
			}
			return { status: "sent", providerId: json.id };
		},

		async parseWebhook(req: Request): Promise<WebhookEvent[]> {
			// Read body via a clone so the secondary signature-verifier path does
			// not consume the stream first.
			const raw = await req.clone().text();
			const events = parseResendEvents(raw);
			if (autoOptOutEnabled && options.autoOptOut?.hook) {
				const parsed = safeParseJson(raw);
				if (parsed !== null) {
					const arr = Array.isArray(parsed) ? parsed : [parsed];
					for (const e of arr) await maybeAutoOptOut(e, options.autoOptOut.hook);
				}
			}
			return events;
		},

		async verifySignature(req: Request, secret: string): Promise<boolean> {
			try {
				await verifyResendSignature(req, secret, { maxAgeMs: options.webhook?.maxAgeMs });
				return true;
			} catch {
				return false;
			}
		},
	};
}

async function maybeAutoOptOut(rawEvent: unknown, hook: EmailOptOutHook): Promise<void> {
	const e = rawEvent as { data?: { to?: string[]; email_id?: string }; type?: string };
	if (!e?.data?.to || e.data.to.length === 0) return;
	const emailAddress = e.data.to[0]!;
	if (isComplaint(rawEvent)) {
		await hook(emailAddress, "email", null, "complaint");
		return;
	}
	if (isHardBounce(rawEvent)) {
		await hook(emailAddress, "email", null, "hard-bounce");
	}
}

/**
 * Chunked Uint8Array → base64 to keep performance predictable on
 * attachment-cap-sized payloads (40 MB). The naive per-byte concatenation
 * is O(n²) in some JS engines and risks exhausting Worker CPU budgets.
 */
function bytesToBase64(bytes: Uint8Array): string {
	const chunkSize = 0x8000;
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		parts.push(String.fromCharCode(...chunk));
	}
	return btoa(parts.join(""));
}
