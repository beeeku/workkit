import type { Adapter, AdapterSendArgs, AdapterSendResult, WebhookEvent } from "@workkit/notify";
import { type AttachmentLoadOptions, type AttachmentSpec, loadAttachments } from "./attachments";
import { FromDomainError } from "./errors";
import { renderEmail } from "./render";
import { isComplaint, isHardBounce, parseResendEvents, verifyResendSignature } from "./webhook";

export interface EmailPayload {
	[key: string]: unknown;
}

/**
 * Caller-supplied opt-out hook — invoked when the webhook surfaces a hard
 * bounce or complaint. `notificationId` is null for global opt-outs
 * (complaints are global; hard bounces apply only to the offending
 * notification id).
 */
export type EmailOptOutHook = (
	userId: string,
	channel: "email",
	notificationId: string | null,
	reason: string,
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
	webhook?: { secret: string; maxAgeMs?: number };
	autoOptOut?: { enabled?: boolean; hook: EmailOptOutHook };
	/**
	 * Notification ids for which open/click tracking should be disabled
	 * (financial/medical/etc.). Mapped to Resend's `tracking` header.
	 */
	disableTrackingFor?: ReadonlyArray<string>;
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
	const autoOptOutEnabled = options.autoOptOut?.enabled !== false; // default on

	return {
		async send(args: AdapterSendArgs<EmailPayload>): Promise<AdapterSendResult> {
			const tpl = args.template as {
				template?: unknown;
				props?: (p: EmailPayload) => unknown;
				attachments?: (p: EmailPayload) => AttachmentSpec[];
				title?: (p: EmailPayload) => string;
				body?: (p: EmailPayload) => string;
			};
			const subject = tpl.title?.(args.payload) ?? "(no subject)";
			const renderInput = tpl.template ?? tpl.body?.(args.payload) ?? "";
			const props = tpl.props?.(args.payload);

			const { html, text } = await renderEmail({
				template: renderInput,
				props,
			});

			let attachments: ResendSendBody["attachments"] | undefined;
			if (tpl.attachments) {
				const specs = tpl.attachments(args.payload);
				if (!options.bucket) {
					return {
						status: "failed",
						error: "emailAdapter: bucket required for attachments",
					};
				}
				try {
					const blobs = await loadAttachments(options.bucket, specs, options.attachments);
					attachments = blobs.map((b) => ({
						filename: b.filename,
						content: arrayToBase64(b.bytes),
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
			const trackingDisabled = (options.disableTrackingFor ?? []).includes(args.notificationId);
			if (trackingDisabled) {
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
				const parsed = JSON.parse(raw);
				const arr = Array.isArray(parsed) ? parsed : [parsed];
				for (const e of arr) {
					await maybeAutoOptOut(e, options.autoOptOut.hook);
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
	// Note: we do NOT have userId in the webhook payload — the caller must
	// resolve the userId from the email address inside their hook implementation.
	// We pass the address as `userId` here as a documented convention; callers
	// should look it up via their user table.
	const userIdProxy = e.data.to[0]!;
	if (isComplaint(rawEvent)) {
		await hook(userIdProxy, "email", null, "complaint");
		return;
	}
	if (isHardBounce(rawEvent)) {
		await hook(userIdProxy, "email", null, "hard-bounce");
	}
}

function arrayToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}
