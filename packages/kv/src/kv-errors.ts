import { InternalError, ValidationError } from "@workkit/errors";

// Re-export the original error helpers for backward compatibility
export { assertKVBinding, assertValidTtl, wrapKVError } from "./errors";
export type { KVErrorContext } from "./errors";

/**
 * Base KV error -- all KV-specific errors extend this.
 */
export class KVError extends InternalError {}

/**
 * KV key not found.
 */
export class KVNotFoundError extends Error {
	readonly code = "WORKKIT_NOT_FOUND" as const;
	readonly statusCode = 404;
	readonly retryable = false;
	readonly kvKey: string;

	constructor(key: string, options?: { cause?: unknown }) {
		super(`KV key "${key}" not found`, options);
		this.name = "KVNotFoundError";
		this.kvKey = key;
	}
}

/**
 * Value failed Standard Schema validation on read.
 */
export class KVValidationError extends ValidationError {
	readonly kvKey: string;
	readonly validationMessage: string;

	constructor(
		key: string,
		validationMessage: string,
		issues?: Array<{ path?: PropertyKey[]; message: string; code?: string }>,
	) {
		super(
			`KV value for "${key}" failed validation: ${validationMessage}`,
			issues?.map((i) => ({
				path: (i.path ?? []).map(String),
				message: i.message,
				code: i.code ?? "WORKKIT_KV_VALIDATION",
			})) ?? [{ path: [key], message: validationMessage, code: "WORKKIT_KV_VALIDATION" }],
		);
		this.kvKey = key;
		this.validationMessage = validationMessage;
	}
}

/**
 * Serialization/deserialization failure.
 */
export class KVSerializationError extends InternalError {
	constructor(operation: "serialize" | "deserialize", key: string, cause?: unknown) {
		super(`Failed to ${operation} KV value for key "${key}"`, {
			cause,
			context: { operation, kvKey: key },
		});
	}
}
