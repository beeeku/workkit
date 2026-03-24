import { WorkkitError } from "@workkit/errors";
import type { RetryStrategy, WorkkitErrorCode, WorkkitErrorOptions } from "@workkit/errors";

/** Base error for all mail operations */
export class MailError extends WorkkitError {
	readonly code: WorkkitErrorCode = "WORKKIT_MAIL_ERROR";
	readonly statusCode: number = 500;
	readonly retryable: boolean = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };
}

/** Thrown when an email address fails validation */
export class InvalidAddressError extends MailError {
	readonly code = "WORKKIT_MAIL_INVALID_ADDRESS" as const;
	readonly statusCode = 400;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	readonly address: string;

	constructor(address: string, options?: WorkkitErrorOptions) {
		super(`Invalid email address: "${address}"`, {
			...options,
			context: { ...options?.context, address },
		});
		this.address = address;
	}
}

/** Thrown when email delivery fails */
export class DeliveryError extends MailError {
	readonly code = "WORKKIT_MAIL_DELIVERY_FAILED" as const;
	readonly statusCode = 502;
	readonly retryable = true;
	readonly defaultRetryStrategy: RetryStrategy = {
		kind: "exponential",
		baseMs: 1000,
		maxMs: 30000,
		maxAttempts: 3,
	};
}
