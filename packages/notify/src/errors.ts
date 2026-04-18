import { ConfigError, ValidationError, WorkkitError } from "@workkit/errors";
import type { RetryStrategy } from "@workkit/errors";

export class NotifyConfigError extends ConfigError {}

export class PayloadValidationError extends ValidationError {
	constructor(
		notificationId: string,
		issues: Array<{ path: ReadonlyArray<PropertyKey>; message: string }>,
	) {
		super(
			`payload for notification "${notificationId}" failed validation`,
			issues.map((i) => ({
				path: i.path.map(String),
				message: i.message,
			})),
		);
	}
}

export class NoRecipientError extends WorkkitError {
	readonly code = "WORKKIT_NOT_FOUND" as const;
	readonly statusCode = 404;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	constructor(userId: string) {
		super(`recipient lookup returned no record for userId "${userId}"`, { context: { userId } });
	}
}
