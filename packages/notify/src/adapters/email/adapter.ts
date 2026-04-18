import type { Adapter, AdapterSendArgs, AdapterSendResult, WebhookEvent } from "../../types";
import { type AttachmentLoadOptions, type AttachmentSpec, loadAttachments } from "./attachments";
import { ProviderMissingError } from "./errors";
import type { EmailAttachmentWire, EmailProvider } from "./provider";
import { renderEmail } from "./render";

export interface EmailPayload {
	[key: string]: unknown;
}

interface R2BucketLike {
	get(key: string): Promise<{
		arrayBuffer: () => Promise<ArrayBuffer>;
		httpMetadata?: { contentType?: string };
	} | null>;
}

export interface EmailAdapterOptions {
	/** Pluggable provider — `cloudflareEmailProvider` (default) or `resendEmailProvider`. */
	provider: EmailProvider;
	/** R2 bucket for loading attachments referenced by templates. */
	bucket?: R2BucketLike;
	attachments?: AttachmentLoadOptions;
	/**
	 * Notification ids that should carry an explicit unsubscribe header
	 * (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`). Resend does not
	 * expose a public flag to disable open/click tracking, so the option
	 * was renamed from `disableTrackingFor` to reflect what it actually
	 * does. Callers wanting full tracking suppression should configure it
	 * in the Resend dashboard. The CF provider forwards `X-*` headers
	 * reliably; `List-Unsubscribe*` survival depends on the MTA path.
	 */
	markUnsubscribable?: ReadonlyArray<string>;
}

export function emailAdapter(options: EmailAdapterOptions): Adapter<EmailPayload> {
	if (!options?.provider) throw new ProviderMissingError();
	const provider = options.provider;

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

			let attachments: EmailAttachmentWire[] | undefined;
			if (tpl.attachments) {
				const specs = tpl.attachments(args.payload);
				if (!options.bucket) {
					return { status: "failed", error: "emailAdapter: bucket required for attachments" };
				}
				try {
					const blobs = await loadAttachments(options.bucket, specs, options.attachments);
					attachments = blobs.map((b) => ({
						filename: b.filename,
						content: b.bytes,
						contentType: b.contentType,
					}));
				} catch (err) {
					return { status: "failed", error: err instanceof Error ? err.message : String(err) };
				}
			}

			const headers: Record<string, string> = {};
			if ((options.markUnsubscribable ?? []).includes(args.notificationId)) {
				headers["X-Entity-Ref-ID"] = args.deliveryId;
				headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
			}

			return provider.send({
				to: args.address,
				subject,
				html,
				text,
				...(attachments ? { attachments } : {}),
				...(Object.keys(headers).length > 0 ? { headers } : {}),
				notificationId: args.notificationId,
				deliveryId: args.deliveryId,
			});
		},

		...(provider.parseWebhook
			? {
					async parseWebhook(req: Request): Promise<WebhookEvent[]> {
						return provider.parseWebhook!(req);
					},
				}
			: {}),

		...(provider.verifySignature
			? {
					async verifySignature(req: Request, secret: string): Promise<boolean> {
						return provider.verifySignature!(req, secret);
					},
				}
			: {}),
	};
}
