import type {
	RetryStrategy,
	SerializedError,
	WorkkitErrorCode,
	WorkkitErrorOptions,
} from "./types";

export abstract class WorkkitError extends Error {
	/** Machine-readable error code — stable across versions */
	abstract readonly code: WorkkitErrorCode;

	/** HTTP status code this error maps to */
	abstract readonly statusCode: number;

	/** Whether this error is retryable */
	abstract readonly retryable: boolean;

	/** Default retry strategy for this error type */
	abstract readonly defaultRetryStrategy: RetryStrategy;

	/** Structured context (binding name, key, table, etc.) */
	readonly context?: Record<string, unknown>;

	/** Overridden retry strategy (if provided at construction) */
	private readonly _retryStrategyOverride?: RetryStrategy;

	/** Timestamp of error creation */
	readonly timestamp: Date;

	constructor(message: string, options?: WorkkitErrorOptions) {
		super(message, { cause: options?.cause });
		this.name = this.constructor.name;
		this.context = options?.context;
		this._retryStrategyOverride = options?.retryStrategy;
		this.timestamp = new Date();

		// Fix prototype chain for instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}

	/** Active retry strategy — override takes precedence over default */
	get retryStrategy(): RetryStrategy {
		return this._retryStrategyOverride ?? this.defaultRetryStrategy;
	}

	/** Structured JSON representation for logging and API responses */
	toJSON(): SerializedError {
		const serialized: SerializedError = {
			name: this.name,
			code: this.code,
			message: this.message,
			statusCode: this.statusCode,
			retryable: this.retryable,
			retryStrategy: this.retryStrategy,
			timestamp: this.timestamp.toISOString(),
		};

		if (this.context && Object.keys(this.context).length > 0) {
			serialized.context = this.context;
		}

		if (this.cause) {
			if (this.cause instanceof WorkkitError) {
				serialized.cause = this.cause.toJSON();
			} else if (this.cause instanceof Error) {
				serialized.cause = { name: this.cause.name, message: this.cause.message };
			}
		}

		return serialized;
	}

	/** Human-readable string with code prefix */
	toString(): string {
		let str = `[${this.code}] ${this.name}: ${this.message}`;
		if (this.context) {
			str += ` | context: ${JSON.stringify(this.context)}`;
		}
		if (this.cause instanceof Error) {
			str += ` | caused by: ${this.cause.message}`;
		}
		return str;
	}
}
