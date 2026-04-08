import { parseDuration } from "./duration";
import type { FixedWindowOptions, FixedWindowState, RateLimitResult, RateLimiter } from "./types";

/**
 * Create a fixed window rate limiter backed by KV.
 *
 * Divides time into fixed windows of the specified duration.
 * Each key gets a counter that resets at the start of each window.
 *
 * @example
 * ```ts
 * const limiter = fixedWindow({
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
export function fixedWindow(options: FixedWindowOptions): RateLimiter {
	const windowMs = parseDuration(options.window);
	const prefix = options.prefix ?? "rl:fw:";

	return {
		async check(key: string): Promise<RateLimitResult> {
			const now = Date.now();
			const windowStart = now - (now % windowMs);
			const kvKey = `${prefix}${key}:${windowStart}`;

			const existing = (await options.namespace.get(kvKey, "json")) as FixedWindowState | null;

			const currentCount = existing ? existing.count : 0;
			const newCount = currentCount + 1;
			const allowed = newCount <= options.limit;
			const remaining = Math.max(0, options.limit - (allowed ? newCount : currentCount));
			const resetAt = new Date(windowStart + windowMs);

			// Only write back to KV when the request is allowed — denied requests
			// must not inflate the counter beyond the limit.
			if (allowed) {
				const state: FixedWindowState = {
					count: newCount,
					windowStart,
				};

				const ttlSeconds = Math.ceil((windowStart + windowMs - now) / 1000);

				await options.namespace.put(kvKey, JSON.stringify(state), {
					expirationTtl: Math.max(ttlSeconds, 1),
				});
			}

			return { allowed, remaining, resetAt, limit: options.limit };
		},
	};
}
