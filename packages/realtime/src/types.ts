export interface RealtimeEvent {
	event: string;
	data: unknown;
	id?: number;
}

export type AuthorizeHook<TEnv = unknown, TPrincipal = unknown> = (
	channel: string,
	request: Request,
	env: TEnv,
) => Promise<TPrincipal | null>;

export interface BrokerConfig<TEnv = unknown, TPrincipal = unknown> {
	authorize: AuthorizeHook<TEnv, TPrincipal>;
	replayBufferSize?: number;
	maxSubscribersPerChannel?: number;
	heartbeatMs?: number;
	channelPattern?: RegExp;
}

export interface SubscribeOptions {
	onEvent: (event: string, data: unknown, id: number) => void;
	onReconnect?: (attempt: number) => void;
	backoff?: { initialMs: number; maxMs: number };
	fallbackPollingUrl?: string;
	pollingAfterMs?: number;
	signal?: AbortSignal;
	/** Server heartbeat cadence — used by the client to detect stalled streams
	 * (aborts after ~2.5x this value with no bytes). Defaults to 30000. */
	heartbeatMs?: number;
}

export interface PublishResult {
	delivered: number;
	id: number;
}

export const DEFAULT_REPLAY_BUFFER_SIZE: number = 50;
export const DEFAULT_MAX_SUBSCRIBERS_PER_CHANNEL: number = 1000;
export const DEFAULT_HEARTBEAT_MS: number = 30_000;
export const DEFAULT_CHANNEL_PATTERN: RegExp = /^[a-zA-Z0-9:_.-]{1,128}$/;
