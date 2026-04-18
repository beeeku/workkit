// Adapter
export { whatsappAdapter } from "./adapter";
export type {
	DndChecker,
	WaOptOutHook,
	WhatsAppAdapterOptions,
	WhatsAppPayload,
	WhatsAppTemplateRef,
} from "./adapter";

// Provider interface + types
export type {
	WaInboundMessage,
	WaMediaRef,
	WaProvider,
	WaProviderEvent,
	WaQualityAlert,
	WaSendArgs,
	WaSendResult,
	WaTemplateRef,
	WaUploadArgs,
	WhatsAppCategory,
} from "./provider";

// Providers
export { metaWaProvider } from "./providers/meta";
export type { MetaWaProviderOptions } from "./providers/meta";
export { twilioWaProvider } from "./providers/twilio";
export type { TwilioWaProviderOptions } from "./providers/twilio";
export { gupshupWaProvider } from "./providers/gupshup";
export type { GupshupWaProviderOptions } from "./providers/gupshup";

// Opt-in
export { recordOptIn, revokeOptIn, isOptedIn, getOptInProof } from "./opt-in";
export type { OptInProof, RecordOptInArgs, OptInDeps } from "./opt-in";

// Session window
export { recordInbound, withinSessionWindow, SESSION_WINDOW_MS } from "./session-window";

// Marketing pause
export { MarketingPauseRegistry } from "./marketing-pause";
export type { MarketingPauseAuditEvent, MarketingPauseAuditHook } from "./marketing-pause";

// Media cache
export {
	cacheKey,
	getCached,
	putCached,
	purgeExpiredMedia,
	DEFAULT_MEDIA_TTL_MS,
} from "./media-cache";
export type { CachedMedia } from "./media-cache";

// Phone
export { assertE164, isE164, identityCipher } from "./phone";
export type { PhoneCipher } from "./phone";

// Keywords
export { isStopKeyword, defaultStopKeywords } from "./keywords";
export type { StopMatchOptions } from "./keywords";

// Forget
export { forgetWhatsAppUser } from "./forget";
export type { ForgetWhatsAppResult } from "./forget";

// Schema
export {
	WA_OPTIN_MIGRATION_SQL,
	WA_MEDIA_CACHE_MIGRATION_SQL,
	WA_INBOUND_LOG_MIGRATION_SQL,
	WA_ALL_MIGRATIONS,
} from "./schema";

// Errors
export {
	MarketingPausedError,
	OptInRequiredError,
	TemplateNotApprovedError,
	WhatsAppPhoneFormatError,
	WhatsAppWebhookSignatureError,
} from "./errors";
