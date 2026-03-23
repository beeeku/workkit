import { quota } from "@workkit/ratelimit";
import type { Context, MiddlewareHandler } from "hono";
import type { QuotaLimitOptions } from "./types";

/**
 * Quota middleware for Hono.
 *
 * Enforces multi-window quota limits (e.g. 10/hour + 100/day).
 * Uses `quota()` from `@workkit/ratelimit` under the hood.
 * Returns 429 with quota breakdown when exceeded.
 *
 * @example
 * ```ts
 * app.use('/api/*', quotaLimit({
 *   namespace: env.RATE_LIMIT_KV,
 *   limits: [
 *     { window: '1h', limit: 10 },
 *     { window: '1d', limit: 100 },
 *   ],
 *   keyFn: (c) => c.req.header('CF-Connecting-IP') ?? 'unknown',
 * }))
 * ```
 */
export function quotaLimit(options: QuotaLimitOptions): MiddlewareHandler {
	const { namespace, limits, keyFn, onQuotaExceeded } = options;

	// Create the quota limiter once — reused across all requests
	const limiter = quota({
		namespace,
		limits: limits.map((l) => ({
			window: l.window as `${number}${"s" | "m" | "h" | "d"}`,
			limit: l.limit,
		})),
	});

	return async (c, next) => {
		const key = await keyFn(c);
		const result = await limiter.check(key);

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

			if (onQuotaExceeded) {
				return onQuotaExceeded(c);
			}

			return c.json(
				{
					error: "Quota exceeded",
					retryAfter: retryAfterSeconds,
					quotas: result.quotas,
				},
				429,
			);
		}

		await next();
	};
}
