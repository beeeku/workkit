import { getRetryDelay, getRetryStrategy, isRetryable } from "@workkit/errors";
import type { AiInput, FallbackEntry, Gateway, RunOptions } from "./types";

/** Options for `withRetry`. */
export interface RetryConfig {
	/** Max attempts including the first try (default: 3) */
	maxAttempts?: number;
	/**
	 * Decide whether a thrown error should trigger another attempt.
	 * Defaults to `isRetryable` from `@workkit/errors`, which checks
	 * `WorkkitError.retryable`.
	 */
	isRetryable?: (err: unknown) => boolean;
}

/**
 * Wrap a gateway with automatic retry on retryable errors.
 *
 * Delay between attempts is driven by each thrown `WorkkitError`'s
 * `retryStrategy` (e.g. `ServiceUnavailableError` uses exponential backoff,
 * `RateLimitError` honors `retry-after`). `maxAttempts` caps the total
 * number of tries; per-call `options.signal` aborts the loop immediately.
 *
 * @example
 * ```ts
 * const resilient = withRetry(gateway, { maxAttempts: 3 })
 * await resilient.run("claude-sonnet-4-6", { prompt: "…" })
 * ```
 */
export function withRetry(gateway: Gateway, config?: RetryConfig): Gateway {
	const maxAttempts = config?.maxAttempts ?? 3;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new RangeError(`withRetry: maxAttempts must be an integer >= 1 (got ${maxAttempts})`);
	}
	const retryable = config?.isRetryable ?? isRetryable;

	const retry = <T>(fn: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> =>
		runWithRetry(fn, maxAttempts, retryable, signal);

	const innerFallback = gateway.runFallback?.bind(gateway);
	const innerStream = gateway.stream?.bind(gateway);

	return {
		run: (model, input, options) =>
			retry(() => gateway.run(model, input, options), options?.signal),
		runFallback: innerFallback
			? (entries: FallbackEntry[], input: AiInput, options?: RunOptions) =>
					retry(() => innerFallback(entries, input, options), options?.signal)
			: undefined,
		// Streaming retries on the initial connect only — once bytes start
		// flowing, mid-stream errors are propagated as-is (retrying would
		// re-emit already-delivered tokens to the consumer).
		stream: innerStream
			? (model: string, input: AiInput, options?: RunOptions) =>
					retry(() => innerStream(model, input, options), options?.signal)
			: undefined,
		providers: () => gateway.providers(),
		defaultProvider: () => gateway.defaultProvider(),
	};
}

async function runWithRetry<T>(
	fn: () => Promise<T>,
	maxAttempts: number,
	retryable: (err: unknown) => boolean,
	signal: AbortSignal | undefined,
): Promise<T> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (signal?.aborted) throw signal.reason ?? new Error("aborted");
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (!retryable(err) || attempt === maxAttempts) throw err;

			const strategy = getRetryStrategy(err);
			if (strategy.kind !== "none") {
				const delay = getRetryDelay(strategy, attempt);
				if (delay === null) throw err;
				if (delay > 0) await sleep(delay, signal);
			}
		}
	}
	throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("aborted"));
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
