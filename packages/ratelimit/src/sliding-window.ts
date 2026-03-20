import { parseDuration } from "./duration";
import type {
	RateLimitResult,
	RateLimiter,
	SlidingWindowOptions,
	SlidingWindowState,
} from "./types";

/**
 * Create a sliding window rate limiter backed by KV.
 *
 * Uses a weighted average of the previous and current windows to
 * approximate a true sliding window. More accurate than fixed window
 * at the cost of an extra KV read.
 *
 * @example
 * ```ts
 * const limiter = slidingWindow({
 *   namespace: env.RATE_LIMIT_KV,
 *   limit: 100,
 *   window: '1m',
 * })
 * const result = await limiter.check('user:123')
 * ```
 *
 * @remarks
 * This implementation provides approximate rate limiting suitable for most use cases.
 * Under high concurrent load from multiple Workers, the actual limit may be briefly
 * exceeded due to KV's eventually-consistent model. For strict mutual exclusion,
 * use Durable Objects as the backing store.
 */
export function slidingWindow(options: SlidingWindowOptions): RateLimiter {
	const windowMs = parseDuration(options.window);
	const prefix = options.prefix ?? "rl:sw:";

	return {
		async check(key: string): Promise<RateLimitResult> {
			const now = Date.now();
			const currentWindowStart = now - (now % windowMs);
			const previousWindowStart = currentWindowStart - windowMs;

			const currentKey = `${prefix}${key}:${currentWindowStart}`;
			const previousKey = `${prefix}${key}:${previousWindowStart}`;

			const [currentState, previousState] = await Promise.all([
				options.namespace.get(currentKey, "json") as Promise<SlidingWindowState | null>,
				options.namespace.get(previousKey, "json") as Promise<SlidingWindowState | null>,
			]);

			const currentCount = currentState ? currentState.count : 0;
			const previousCount = previousState ? previousState.count : 0;

			// Weight of previous window: how much of the current window hasn't elapsed yet
			const elapsedInWindow = now - currentWindowStart;
			const previousWeight = 1 - elapsedInWindow / windowMs;
			const weightedPreviousCount = Math.floor(previousCount * previousWeight);

			// New count after this request
			const newCurrentCount = currentCount + 1;
			const weightedTotal = weightedPreviousCount + newCurrentCount;
			const allowed = weightedTotal <= options.limit;
			const remaining = Math.max(0, options.limit - weightedTotal);

			// Reset at end of current window
			const resetAt = new Date(currentWindowStart + windowMs);

			// Store updated current window count
			const state: SlidingWindowState = {
				count: newCurrentCount,
				windowStart: currentWindowStart,
			};

			const ttlSeconds = Math.ceil((currentWindowStart + windowMs * 2 - now) / 1000);

			await options.namespace.put(currentKey, JSON.stringify(state), {
				expirationTtl: Math.max(ttlSeconds, 1),
			});

			return { allowed, remaining, resetAt, limit: options.limit };
		},
	};
}
