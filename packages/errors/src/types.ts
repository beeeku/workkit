/**
 * Machine-readable error codes — stable across versions.
 * Consumers switch on these, not error classes.
 */
export type WorkkitErrorCode =
	| "WORKKIT_BINDING_ERROR"
	| "WORKKIT_BINDING_NOT_FOUND"
	| "WORKKIT_NOT_FOUND"
	| "WORKKIT_CONFLICT"
	| "WORKKIT_VALIDATION"
	| "WORKKIT_TIMEOUT"
	| "WORKKIT_RATE_LIMIT"
	| "WORKKIT_SERVICE_UNAVAILABLE"
	| "WORKKIT_UNAUTHORIZED"
	| "WORKKIT_FORBIDDEN"
	| "WORKKIT_INTERNAL"
	| "WORKKIT_CONFIG"
	| "WORKKIT_D1_QUERY"
	| "WORKKIT_D1_CONSTRAINT"
	| "WORKKIT_D1_BATCH"
	| "WORKKIT_D1_MIGRATION"
	| "WORKKIT_MAIL_ERROR"
	| "WORKKIT_MAIL_INVALID_ADDRESS"
	| "WORKKIT_MAIL_DELIVERY_FAILED"
	| "WORKKIT_TURNSTILE"
	| "WORKKIT_AGENT_HANDOFF_CYCLE"
	| "WORKKIT_AGENT_BUDGET";

/**
 * Retry strategy classification.
 * Attached to every error — consumers never need to guess.
 */
export type RetryStrategy =
	| { kind: "none" }
	| { kind: "immediate"; maxAttempts: number }
	| { kind: "fixed"; delayMs: number; maxAttempts: number }
	| { kind: "exponential"; baseMs: number; maxMs: number; maxAttempts: number };

/**
 * Serialized error shape for JSON logging / API responses.
 */
export interface SerializedError {
	name: string;
	code: WorkkitErrorCode;
	message: string;
	statusCode: number;
	retryable: boolean;
	retryStrategy: RetryStrategy;
	cause?: SerializedError | { message: string; name: string };
	context?: Record<string, unknown>;
	timestamp: string;
}

/**
 * Options for constructing any WorkkitError.
 */
export interface WorkkitErrorOptions {
	/** Original error that caused this one */
	cause?: unknown;
	/** Arbitrary structured context (binding name, key, table, etc.) */
	context?: Record<string, unknown>;
	/** Override the default retry strategy for this error instance */
	retryStrategy?: RetryStrategy;
}
