// Adapter
export { inAppAdapter } from "./adapter";
export type { InAppAdapterOptions, InAppPayload } from "./adapter";

// Feed queries
export { feed, markRead, dismiss, unreadCount } from "./feed";
export type {
	FeedOptions,
	FeedPage,
	InAppNotificationRow,
	MarkReadOptions,
} from "./feed";

// SSE
export { SseRegistry, createSseHandler } from "./sse";
export type { SseHandlerOptions, SseSubscriber } from "./sse";

// Safety helpers
export { safeLink } from "./safe-link";
export type { SafeLinkOptions } from "./safe-link";

// Forget
export { forgetInAppUser } from "./forget";
export type { ForgetInAppResult } from "./forget";

// Schema
export { INAPP_MIGRATION_SQL } from "./schema";

// Errors
export { BodyTooLongError, UnsafeLinkError } from "./errors";
