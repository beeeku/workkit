import { WorkkitError } from "@workkit/errors";
import type { RetryStrategy, WorkkitErrorOptions } from "@workkit/errors";

/**
 * Error thrown when Turnstile verification fails.
 */
export class TurnstileError extends WorkkitError {
	readonly code = "WORKKIT_TURNSTILE" as const;
	readonly statusCode = 403;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	readonly errorCodes: string[];

	constructor(message: string, errorCodes: string[] = [], options?: WorkkitErrorOptions) {
		super(message, {
			...options,
			context: { ...options?.context, errorCodes },
		});
		this.errorCodes = errorCodes;
	}
}
