// Sender
export { mail } from "./sender";

// Receiver
export { createEmailHandler } from "./receiver";

// Router
export { createEmailRouter } from "./router";

// Compose
export { composeMessage } from "./compose";

// Parser
export { parseEmail } from "./parser";
export type { ParsedEmail } from "./parser";

// Bounces (RFC 3464 DSN parser)
export { parseBounceDSN } from "./bounces";
export type { BounceInfo, BounceKind } from "./bounces";

// Validation
export { validateAddress, isValidAddress } from "./validation";

// Errors
export { MailError, InvalidAddressError, DeliveryError } from "./errors";

// Types
export type {
	MailAddress,
	MailAttachment,
	MailOptions,
	MailMessage,
	SendResult,
	TypedMailClient,
	InboundEmail,
	ParsedAttachment,
	ReplyMessage,
	EmailHandlerFn,
	EmailHandlerOptions,
	EmailRouteMatcher,
	EmailRoute,
	EmailRouter,
	ComposeOptions,
	ComposedMessage,
} from "./types";
