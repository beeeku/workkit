// define / send
export { define } from "./define";
export type { Notification, DefineDeps } from "./define";

// dispatch + consumer
export { dispatch } from "./dispatch";
export type { DispatchInput, DispatchOutcome } from "./dispatch";
export { createNotifyConsumer } from "./consumer";
export type { NotifyConsumerOptions, ConsumerLookup } from "./consumer";

// adapters
export { AdapterRegistry, buildRegistry } from "./adapters";

// preferences / opt-out
export { readPreferences, upsertPreferences } from "./preferences";
export { isOptedOut, optOut, listOptOuts } from "./opt-out";
export type { OptOutRecord } from "./opt-out";

// quiet hours
export { isWithinQuietHours } from "./quiet-hours";

// records
export {
	insertDelivery,
	updateDeliveryStatus,
	findByIdempotencyKey,
	purgeOlderThan,
} from "./records";
export type { DeliveryRow, InsertDeliveryArgs } from "./records";

// idempotency
export { canonicalJson, sha256Hex, buildIdempotencyKey } from "./idempotency";

// webhooks
export { webhookHandler } from "./webhooks";
export type { WebhookHandlerOptions } from "./webhooks";

// forget
export { forgetUser } from "./forget";
export type { ForgetUserResult } from "./forget";

// config
export { DEFAULT_CONFIG, resolveConfig } from "./config";

// schema
export {
	NOTIFICATION_PREFS_SQL,
	NOTIFICATION_OPTOUTS_SQL,
	NOTIFICATION_DELIVERIES_SQL,
	ALL_MIGRATIONS,
} from "./schema";

// errors
export { NotifyConfigError, NoRecipientError, PayloadValidationError } from "./errors";

// types
export type {
	Adapter,
	AdapterSendArgs,
	AdapterSendResult,
	ChannelName,
	ChannelTemplate,
	DefineNotificationOptions,
	DeliveryStatus,
	DispatchJob,
	DispatchMode,
	NotificationPreferences,
	NotifyConfig,
	NotifyDeps,
	NotifyD1,
	NotifyPreparedStatement,
	Priority,
	QuietHours,
	Recipient,
	RecipientChannelAddress,
	Resolver,
	SendOptions,
	SendResult,
	WebhookEvent,
} from "./types";
