import { adapterFailedFromError } from "../../../adapter-result";
import type { AdapterSendResult } from "../../../types";
import type { EmailAttachmentWire, EmailProvider, EmailProviderSendArgs } from "../provider";

export interface CloudflareEmailProviderOptions {
	/** The `SendEmail` binding from `[[send_email]]` in wrangler.toml */
	binding: SendEmail;
	from: string;
	replyTo?: string | string[];
}

// Lazy loader for @workkit/mail — kept optional so consumers of
// `@workkit/notify/email` who only use `resendEmailProvider` don't pay
// the install cost or hit a module-resolution error.
type MailModule = typeof import("@workkit/mail");
let mailModulePromise: Promise<MailModule> | null = null;
function loadMail(): Promise<MailModule> {
	if (!mailModulePromise) mailModulePromise = import("@workkit/mail");
	return mailModulePromise;
}

/**
 * Default email provider — delegates to `@workkit/mail` which wraps
 * Cloudflare's `send_email` binding (transactional email, beta).
 *
 * `parseWebhook` / `verifySignature` are intentionally omitted: the binding
 * exposes no delivery-webhook surface. Bounce handling is a follow-up (see
 * `createBounceRoute` in the roadmap — parses inbound DSN via Email Routing).
 *
 * Requires `@workkit/mail` as an optional peerDependency — imported lazily
 * at first `send()` call.
 */
export function cloudflareEmailProvider(options: CloudflareEmailProviderOptions): EmailProvider {
	const replyTo = normalizeReplyTo(options.replyTo);

	return {
		name: "cloudflare",

		async send(args: EmailProviderSendArgs): Promise<AdapterSendResult> {
			try {
				const { mail } = await loadMail();
				const client = mail(options.binding, { defaultFrom: options.from });
				const { messageId } = await client.send({
					to: args.to,
					subject: args.subject,
					text: args.text,
					html: args.html,
					...(replyTo ? { replyTo } : {}),
					...(args.attachments && args.attachments.length > 0
						? { attachments: toMailAttachments(args.attachments) }
						: {}),
					...(args.headers && Object.keys(args.headers).length > 0
						? { headers: args.headers }
						: {}),
				});
				return { status: "sent", providerId: messageId };
			} catch (err) {
				// `@workkit/mail` throws WorkkitError subclasses (DeliveryError →
				// retryable, InvalidAddressError → terminal). adapterFailedFromError
				// preserves their `retryable` and `retryStrategy` so consumers /
				// queue policy can act on them. See ADR-002.
				return adapterFailedFromError(err);
			}
		},
	};
}

/**
 * @workkit/mail's `replyTo` accepts a single string. An array is treated as
 * "first wins" (CF honors only one). An empty string or empty array is
 * treated as unset — returning `undefined` lets the caller omit the field
 * entirely rather than emitting a malformed `Reply-To:` header.
 */
function normalizeReplyTo(value: string | string[] | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		const first = value.find((v) => v.length > 0);
		return first;
	}
	return value.length > 0 ? value : undefined;
}

function toMailAttachments(
	attachments: readonly EmailAttachmentWire[],
): { filename: string; content: Uint8Array; contentType: string }[] {
	return attachments.map((a) => ({
		filename: a.filename,
		content: a.content,
		contentType: a.contentType,
	}));
}
