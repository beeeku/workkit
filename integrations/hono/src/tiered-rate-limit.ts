import { tiered } from "@workkit/ratelimit";
import type { MiddlewareHandler } from "hono";
import type { TieredRateLimitOptions } from "./types";

/**
 * Tiered rate limiting middleware for Hono.
 *
 * Applies different rate limits based on user tier (e.g. free, pro, enterprise).
 * Uses `tiered()` from `@workkit/ratelimit` under the hood.
 *
 * @example
 * ```ts
 * app.use('/api/*', tieredRateLimit({
 *   namespace: env.RATE_LIMIT_KV,
 *   tiers: { free: { limit: 100 }, pro: { limit: 10000 } },
 *   window: '1h',
 *   keyFn: (c) => c.req.header('CF-Connecting-IP') ?? 'unknown',
 *   tierFn: (c) => getUserTier(c),
 * }))
 * ```
 */
export function tieredRateLimit(options: TieredRateLimitOptions): MiddlewareHandler {
	const { namespace, tiers, window, keyFn, tierFn, onRateLimited, defaultTier } = options;

	// Create the tiered limiter once — reused across all requests
	const limiter = tiered({
		namespace,
		tiers,
		window: window as `${number}${"s" | "m" | "h" | "d"}`,
		defaultTier,
	});

	return async (c, next) => {
		const key = await keyFn(c);
		const tier = await tierFn(c);

		let result: Awaited<ReturnType<typeof limiter.check>>;
		try {
			result = await limiter.check(key, tier);
		} catch (err) {
			// If tier resolution fails (unknown tier, no default), return 500
			return c.json({ error: "Internal server error" }, 500);
		}

		// Set rate limit headers
		c.header("X-RateLimit-Limit", String(result.limit));
		c.header("X-RateLimit-Remaining", String(result.remaining));
		c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt.getTime() / 1000)));

		if (!result.allowed) {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
			);
			c.header("Retry-After", String(retryAfterSeconds));

			if (onRateLimited) {
				return onRateLimited(c);
			}

			return c.json(
				{
					error: "Rate limit exceeded",
					retryAfter: retryAfterSeconds,
				},
				429,
			);
		}

		await next();
	};
}
