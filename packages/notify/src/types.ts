import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ChannelName = string;

export type DeliveryStatus =
	| "queued"
	| "sent"
	| "delivered"
	| "read"
	| "failed"
	| "bounced"
	| "skipped"
	| "duplicate";

export type Priority = "normal" | "high";

export type DispatchMode = "live" | "test";

export interface RecipientChannelAddress {
	channel: ChannelName;
	address: string;
	verified?: boolean;
}

export interface Recipient {
	userId: string;
	timezone?: string;
	channels: RecipientChannelAddress[];
}

/**
 * Caller-supplied resolver: given a userId, return the recipient record.
 * Notify does not query your user table; it asks you for what it needs.
 */
export type Resolver = (userId: string) => Promise<Recipient | null>;

export interface QuietHours {
	start: string; // "HH:mm" — local to the recipient's timezone
	end: string; // "HH:mm"
	timezone: string; // IANA, e.g. "Asia/Kolkata"
}

export interface NotificationPreferences {
	channels: ChannelName[]; // ordered preferred channels for this notification
	quietHours?: QuietHours;
}

export interface ChannelTemplate<P> {
	/**
	 * The template body. Adapters interpret it differently:
	 *  - `email`: `string` HTML, or a React Email element rendered via the
	 *    optional `@react-email/render` peer.
	 *  - `whatsapp`: typically a template id or full template object.
	 *  - others: as the adapter documents.
	 *
	 * Typed as `unknown` so adapters can accept their own narrower shape
	 * without forcing every other adapter to deal with it.
	 */
	template?: unknown;
	variables?: (payload: P) => Record<string, unknown>;
	props?: (payload: P) => unknown;
	attachments?: (payload: P) => Array<{ filename?: string; r2Key: string; type?: string }>;
	title?: (payload: P) => string;
	body?: (payload: P) => string;
	deepLink?: (payload: P) => string;
}

export interface DefineNotificationOptions<P> {
	id: string;
	schema: StandardSchemaV1<P>;
	channels: Record<ChannelName, ChannelTemplate<P>>;
	/** Ordered chain of channels to try when earlier channels fail/skip. */
	fallback?: ChannelName[];
	priority?: Priority;
}

export interface SendOptions {
	idempotencyKey?: string;
	mode?: DispatchMode;
}

export interface SendResult {
	id: string; // dispatch row id
	status: "queued" | "duplicate";
	idempotencyKey: string;
}

export interface AdapterSendArgs<P = unknown> {
	userId: string;
	notificationId: string;
	channel: ChannelName;
	address: string;
	template: ChannelTemplate<P>;
	payload: P;
	deliveryId: string;
	mode: DispatchMode;
}

export interface AdapterSendResult {
	providerId?: string;
	status: Exclude<DeliveryStatus, "queued" | "duplicate" | "skipped">;
	error?: string;
	/**
	 * Optional. Whether the failure should be retried. Adapters that catch
	 * a `WorkkitError` populate this from `WorkkitError.retryable`; other
	 * adapters can leave it undefined. See ADR-002.
	 */
	retryable?: boolean;
	/**
	 * Optional. Recommended backoff strategy for the failure. Adapters that
	 * catch a `WorkkitError` populate this from `WorkkitError.retryStrategy`.
	 * Consumers / queue policy can opt into reading this field; today it is
	 * not yet acted on by `createNotifyConsumer` (see ADR-002 follow-ups).
	 */
	retryStrategy?: import("@workkit/errors").RetryStrategy;
}

export interface WebhookEvent {
	channel: ChannelName;
	providerId: string;
	status: Extract<DeliveryStatus, "delivered" | "read" | "failed" | "bounced">;
	at: number; // ms epoch
	raw?: unknown;
}

export interface Adapter<P = unknown> {
	send(args: AdapterSendArgs<P>): Promise<AdapterSendResult>;
	parseWebhook?(req: Request): Promise<WebhookEvent[]>;
	verifySignature?(req: Request, secret: string): Promise<boolean>;
}

export interface NotifyConfig {
	/** Notification IDs allowed to bypass quiet hours when priority:'high'. */
	priorityAllowlist: ReadonlyArray<string>;
	/** Default delivery-record retention in days. */
	deliveryRetentionDays: number;
}

export interface DispatchJob<P = unknown> {
	id: string;
	userId: string;
	notificationId: string;
	payload: P;
	idempotencyKey: string;
	priority: Priority;
	mode: DispatchMode;
	createdAt: number;
}

/** Minimal D1-shape we depend on. Matches @cloudflare/workers-types' D1Database. */
export interface NotifyD1 {
	prepare(query: string): NotifyPreparedStatement;
	batch(statements: NotifyPreparedStatement[]): Promise<unknown[]>;
}
export interface NotifyPreparedStatement {
	bind(...values: unknown[]): NotifyPreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
	run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

export interface NotifyDeps<P = unknown> {
	db: NotifyD1;
	resolver: Resolver;
	adapters: Record<ChannelName, Adapter<P>>;
	config?: Partial<NotifyConfig>;
	logger?: {
		info: (msg: string, meta?: Record<string, unknown>) => void;
		error?: (msg: string, meta?: Record<string, unknown>) => void;
	};
	now?: () => number;
}
