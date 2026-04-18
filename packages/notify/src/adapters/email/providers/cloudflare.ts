import { mail } from "@workkit/mail";
import type { AdapterSendResult } from "../../../types";
import type { EmailAttachmentWire, EmailProvider, EmailProviderSendArgs } from "../provider";

export interface CloudflareEmailProviderOptions {
	/** The `SendEmail` binding from `[[send_email]]` in wrangler.toml */
	binding: SendEmail;
	from: string;
	replyTo?: string | string[];
}

/**
 * Default email provider — delegates to `@workkit/mail` which wraps
 * Cloudflare's `send_email` binding (transactional email, beta).
 *
 * `parseWebhook` / `verifySignature` are intentionally omitted: the binding
 * exposes no delivery-webhook surface. Bounce handling is a follow-up (see
 * `createBounceRoute` in the roadmap — parses inbound DSN via Email Routing).
 *
 * Requires `@workkit/mail` as an optional peerDependency.
 */
export function cloudflareEmailProvider(options: CloudflareEmailProviderOptions): EmailProvider {
	const client = mail(options.binding, { defaultFrom: options.from });

	return {
		name: "cloudflare",

		async send(args: EmailProviderSendArgs): Promise<AdapterSendResult> {
			try {
				const { messageId } = await client.send({
					to: args.to,
					subject: args.subject,
					text: args.text,
					html: args.html,
					...(options.replyTo ? { replyTo: toReplyTo(options.replyTo) } : {}),
					...(args.attachments && args.attachments.length > 0
						? { attachments: toMailAttachments(args.attachments) }
						: {}),
					...(args.headers && Object.keys(args.headers).length > 0
						? { headers: args.headers }
						: {}),
				});
				return { status: "sent", providerId: messageId };
			} catch (err) {
				return { status: "failed", error: err instanceof Error ? err.message : String(err) };
			}
		},
	};
}

function toReplyTo(value: string | string[]): string {
	// @workkit/mail's replyTo accepts a single string | MailAddress. If the
	// caller passed an array, pick the first — Resend supports multiple but
	// the CF binding only honors one.
	return Array.isArray(value) ? (value[0] ?? "") : value;
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
