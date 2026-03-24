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
