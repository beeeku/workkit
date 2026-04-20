import { WorkkitError } from "@workkit/errors";
import type { AdapterSendResult } from "./types";

/**
 * Convert any thrown value into a failed `AdapterSendResult`. When the
 * value is a `WorkkitError`, populates `retryable` and `retryStrategy`
 * from it; otherwise the structured fields are left undefined and only
 * `error` (the stringified message) is set. See ADR-002.
 *
 * Adapter authors can use this helper in their `catch` blocks to avoid
 * inlining the `instanceof WorkkitError` check on every provider:
 *
 * ```ts
 * try {
 *   const { messageId } = await provider.deliver(...);
 *   return { status: "sent", providerId: messageId };
 * } catch (err) {
 *   return adapterFailedFromError(err);
 * }
 * ```
 */
export function adapterFailedFromError(err: unknown): AdapterSendResult {
	if (err instanceof WorkkitError) {
		return {
			status: "failed",
			error: err.message,
			retryable: err.retryable,
			retryStrategy: err.retryStrategy,
		};
	}
	return {
		status: "failed",
		error: err instanceof Error ? err.message : String(err),
	};
}
