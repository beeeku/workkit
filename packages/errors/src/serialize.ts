import { WorkkitError } from "./base";
import { InternalError } from "./categories/internal";
import type { SerializedError } from "./types";

/**
 * Serialize any error (workkit or native) to a structured log-friendly format.
 * Useful for logging pipelines that need consistent error shapes.
 */
export function serializeError(
	error: unknown,
): SerializedError | { message: string; name: string } {
	if (error instanceof WorkkitError) {
		return error.toJSON();
	}

	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
		};
	}

	return {
		name: "UnknownError",
		message: String(error),
	};
}

/**
 * Wrap an unknown error as a WorkkitError, preserving it as the cause.
 * If it's already a WorkkitError, returns it unchanged.
 */
export function wrapError(error: unknown, message?: string): WorkkitError {
	if (error instanceof WorkkitError) {
		return error;
	}

	return new InternalError(message ?? (error instanceof Error ? error.message : String(error)), {
		cause: error,
	});
}
