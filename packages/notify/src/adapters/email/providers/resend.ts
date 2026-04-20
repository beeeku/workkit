import { RetryStrategies } from "@workkit/errors";
import type { AdapterSendResult, WebhookEvent } from "../../../types";
import { FromDomainError } from "../errors";
import type { EmailAttachmentWire, EmailProvider, EmailProviderSendArgs } from "../provider";
import {
	isComplaint,
	isHardBounce,
	parseResendEvents,
	safeParseJson,
	verifyResendSignature,
} from "../webhook";

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

export interface ResendEmailProviderOptions {
	apiKey: string;
	from: string;
	replyTo?: string | string[];
	apiUrl?: string;
	webhook?: { maxAgeMs?: number };
	autoOptOut?: { enabled?: boolean; hook: EmailOptOutHook };
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

export function resendEmailProvider(options: ResendEmailProviderOptions): EmailProvider {
	if (!FROM_RE.test(options.from)) throw new FromDomainError(options.from);
	const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
	const autoOptOutEnabled = options.autoOptOut?.enabled !== false;

	return {
		name: "resend",

		async send(args: EmailProviderSendArgs): Promise<AdapterSendResult> {
			const body: ResendSendBody = {
				from: options.from,
				to: [args.to],
				subject: args.subject,
				html: args.html,
				text: args.text,
				...(options.replyTo ? { reply_to: options.replyTo } : {}),
				...(args.attachments && args.attachments.length > 0
					? { attachments: encodeAttachments(args.attachments) }
					: {}),
				...(args.headers && Object.keys(args.headers).length > 0 ? { headers: args.headers } : {}),
			};

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
				// Network-level failure — DNS, TLS, connection reset. Always
				// retryable with exponential backoff. See ADR-002.
				return {
					status: "failed",
					error: err instanceof Error ? err.message : String(err),
					retryable: true,
					retryStrategy: RetryStrategies.exponential(),
				};
			}

			let json: ResendSendResponse | null = null;
			try {
				json = (await resp.json()) as ResendSendResponse;
			} catch {
				json = null;
			}
			if (!resp.ok) {
				// 5xx and 429 are retryable (server / rate limit); other 4xx
				// are terminal (auth, validation, malformed payload). See
				// ADR-002.
				const transient = resp.status >= 500 || resp.status === 429;
				return {
					status: "failed",
					error: json?.error?.message ?? `resend HTTP ${resp.status} ${resp.statusText}`,
					retryable: transient,
					retryStrategy: transient ? RetryStrategies.exponential() : RetryStrategies.none(),
				};
			}
			if (!json?.id) {
				// Resend returned 2xx but no id — response-shape regression on
				// their side. Not safe to retry blindly (we may have already
				// queued the email server-side); flag as terminal.
				return {
					status: "failed",
					error: "resend response missing id",
					retryable: false,
					retryStrategy: RetryStrategies.none(),
				};
			}
			return { status: "sent", providerId: json.id };
		},

		async parseWebhook(req: Request): Promise<WebhookEvent[]> {
			// Read body via a clone so the signature-verifier path does not
			// consume the stream first.
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

function encodeAttachments(
	attachments: readonly EmailAttachmentWire[],
): { filename: string; content: string; content_type: string }[] {
	return attachments.map((a) => ({
		filename: a.filename,
		content: bytesToBase64(a.content),
		content_type: a.contentType,
	}));
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
