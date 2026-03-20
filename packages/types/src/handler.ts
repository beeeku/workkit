import type { TypedMessageBatch } from "./bindings";
import type { JsonValue } from "./json";

// --- Core handler types ---

/** A Workers fetch handler, parameterized by env type */
export type WorkerFetchHandler<E = unknown> = (
	request: Request,
	env: E,
	ctx: ExecutionContext,
) => Response | Promise<Response>;

/** A Workers scheduled handler */
export type WorkerScheduledHandler<E = unknown> = (
	event: ScheduledEvent,
	env: E,
	ctx: ExecutionContext,
) => void | Promise<void>;

/** A Workers queue handler */
export type WorkerQueueHandler<E = unknown, Body = unknown> = (
	batch: TypedMessageBatch<Body>,
	env: E,
	ctx: ExecutionContext,
) => void | Promise<void>;

/** A Workers email handler */
export type WorkerEmailHandler<E = unknown> = (
	message: EmailMessage,
	env: E,
	ctx: ExecutionContext,
) => void | Promise<void>;

/** Complete Workers module export */
export interface WorkerModule<E = unknown> {
	fetch?: WorkerFetchHandler<E>;
	scheduled?: WorkerScheduledHandler<E>;
	queue?: WorkerQueueHandler<E>;
	email?: WorkerEmailHandler<E>;
	tail?: (events: TraceItem[], env: E, ctx: ExecutionContext) => void | Promise<void>;
	trace?: (traces: TraceItem[], env: E, ctx: ExecutionContext) => void | Promise<void>;
}

// --- Execution context ---

export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
	abort(reason?: any): void;
}

// --- Scheduled event ---

export interface ScheduledEvent {
	scheduledTime: number;
	cron: string;
	noRetry(): void;
}

// --- Email message (minimal — full type in @cloudflare/workers-types) ---

export interface EmailMessage {
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream;
	readonly rawSize: number;
	setReject(reason: string): void;
	forward(rcptTo: string, headers?: Headers): Promise<void>;
}

// --- Trace item (minimal) ---

export interface TraceItem {
	readonly event: TraceEvent | null;
	readonly eventTimestamp: number | null;
	readonly logs: TraceLog[];
	readonly exceptions: TraceException[];
	readonly scriptName: string | null;
	readonly scriptVersion?: string;
	readonly dispatchNamespace?: string;
	readonly scriptTags?: string[];
	readonly outcome: string;
}

export interface TraceEvent {
	[key: string]: unknown;
}

export interface TraceLog {
	timestamp: number;
	level: string;
	message: JsonValue;
}

export interface TraceException {
	timestamp: number;
	name: string;
	message: string;
}
