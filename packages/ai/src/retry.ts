import {
	BindingNotFoundError,
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
} from "@workkit/errors";
import type { AiBinding, BackoffStrategy, RetryOptions, RetryResult } from "./types";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 30000;

/**
 * Calculate delay for a given retry attempt using the specified backoff strategy.
 *
 * @param strategy - The backoff strategy
 * @param attempt - Zero-based attempt number (0 = first retry)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 *
 * @deprecated Internal helper for the deprecated `withRetry`. Use
 * `withRetry(gateway, { maxAttempts })` from `@workkit/ai-gateway`, which
 * drives retry delays from each `WorkkitError`'s own `retryStrategy`.
 */
export function calculateDelay(
	strategy: BackoffStrategy,
	attempt: number,
	baseDelay: number = DEFAULT_BASE_DELAY,
	maxDelay: number = DEFAULT_MAX_DELAY,
): number {
	let delay: number;

	switch (strategy) {
		case "fixed":
			delay = baseDelay;
			break;
		case "linear":
			delay = baseDelay * (attempt + 1);
			break;
		case "exponential":
			delay = baseDelay * 2 ** attempt;
			break;
		default:
			delay = baseDelay;
	}

	return Math.min(delay, maxDelay);
}

/**
 * Default check for whether an error is retryable.
 * Retries on timeout, rate limit, and service unavailable errors.
 *
 * @deprecated Internal helper for the deprecated `withRetry`. Use
 * `isRetryable` from `@workkit/errors` (checks `WorkkitError.retryable`).
 */
export function defaultIsRetryable(error: unknown): boolean {
	if (error instanceof TimeoutError) return true;
	if (error instanceof RateLimitError) return true;
	if (error instanceof ServiceUnavailableError) return true;

	// Retry on generic network-like errors
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg.includes("timeout") || msg.includes("rate limit") || msg.includes("unavailable")) {
			return true;
		}
	}

	return false;
}

/**
 * Run an AI model with automatic retry and backoff.
 *
 * @param binding - The AI binding from the worker environment
 * @param model - The model identifier
 * @param inputs - Model input parameters
 * @param options - Retry configuration
 * @returns The result with retry metadata
 * @throws The last error encountered if all retries are exhausted
 * @throws {BindingNotFoundError} If the binding is nullish
 *
 * @example
 * ```ts
 * const result = await withRetry(env.AI, '@cf/meta/llama-3.1-8b-instruct', {
 *   messages: [{ role: 'user', content: 'Hello' }],
 * }, {
 *   maxRetries: 3,
 *   backoff: 'exponential',
 * })
 * ```
 *
 * @deprecated Use `withRetry(gateway, { maxAttempts })` from `@workkit/ai-gateway`.
 * That wrapper retries the unified gateway (covering Workers AI + OpenAI +
 * Anthropic + custom) and uses each `WorkkitError`'s own `retryStrategy`.
 * See ADR-001; tracked in #63.
 */
export async function withRetry<T = unknown>(
	binding: AiBinding,
	model: string,
	inputs: Record<string, unknown>,
	options?: RetryOptions,
): Promise<RetryResult<T>> {
	if (!binding) {
		throw new BindingNotFoundError("AI");
	}

	const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const backoff = options?.backoff ?? "exponential";
	const baseDelay = options?.baseDelay ?? DEFAULT_BASE_DELAY;
	const maxDelay = options?.maxDelay ?? DEFAULT_MAX_DELAY;
	const isRetryable = options?.isRetryable ?? defaultIsRetryable;

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// Check for abort before each attempt
			if (options?.signal?.aborted) {
				throw options.signal.reason ?? new Error("Aborted");
			}

			const runOptions: Record<string, unknown> = {};
			if (options?.signal) runOptions.signal = options.signal;

			const data = (await binding.run(model, inputs, runOptions)) as T;

			return {
				data,
				model,
				retries: attempt,
			};
		} catch (err) {
			lastError = err;

			// Don't retry if we've exhausted attempts
			if (attempt >= maxRetries) {
				break;
			}

			// Don't retry non-retryable errors
			if (!isRetryable(err)) {
				break;
			}

			// Wait before retrying
			const delay = calculateDelay(backoff, attempt, baseDelay, maxDelay);
			await sleep(delay);
		}
	}

	throw lastError;
}

/** Sleep for the specified number of milliseconds */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
