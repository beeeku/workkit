export { emailAdapter } from "./adapter";
export type { EmailAdapterOptions, EmailPayload } from "./adapter";

export type {
	EmailProvider,
	EmailProviderSendArgs,
	EmailAttachmentWire,
} from "./provider";

export { cloudflareEmailProvider } from "./providers/cloudflare";
export type { CloudflareEmailProviderOptions } from "./providers/cloudflare";

export { resendEmailProvider } from "./providers/resend";
export type { ResendEmailProviderOptions, EmailOptOutHook } from "./providers/resend";

export { createBounceRoute } from "./bounce-route";
export type { BounceRouteOptions } from "./bounce-route";

export { renderEmail, htmlToText } from "./render";

export { loadAttachments } from "./attachments";
export type { AttachmentSpec, AttachmentBlob, AttachmentLoadOptions } from "./attachments";

export {
	parseResendEvents,
	verifyResendSignature,
	isComplaint,
	isHardBounce,
} from "./webhook";

export {
	AttachmentTooLargeError,
	FromDomainError,
	WebhookSignatureError,
	ProviderMissingError,
} from "./errors";
