export { emailAdapter } from "./adapter";
export type { EmailAdapterOptions, EmailOptOutHook, EmailPayload } from "./adapter";

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
} from "./errors";
