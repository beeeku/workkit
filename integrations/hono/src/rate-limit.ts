import { RateLimitError } from "@workkit/errors";
import type { MiddlewareHandler } from "hono";
import type { FixedWindowOptions, RateLimitOptions, RateLimitResult, RateLimiter } from "./types";

/**
 * Rate limit middleware for Hono.
 *
 * @example
 * ```ts
 * app.use('/api/*', rateLimit({
 *   limiter: fixedWindow({ namespace: env.KV, limit: 100, window: '1m' }),
 *   keyFn: (c) => c.req.header('CF-Connecting-IP') ?? 'unknown',
 * }))
 * ```
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
	const { limiter, keyFn, onRateLimited } = options;

	return async (c, next) => {
		const key = await keyFn(c);
		const result = await limiter.check(key);

		// Set rate limit headers regardless of outcome
		c.header("X-RateLimit-Limit", String(result.remaining + (result.allowed ? 0 : 1)));
		c.header("X-RateLimit-Remaining", String(result.remaining));
		c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

		if (!result.allowed) {
			if (onRateLimited) {
				return onRateLimited(c, result);
			}

			const retryAfterMs = result.resetAt - Date.now();
			throw new RateLimitError("Rate limit exceeded", retryAfterMs > 0 ? retryAfterMs : undefined);
		}

		await next();
	};
}

/**
 * Parse a duration string like '1m', '5m', '1h', '1d' into milliseconds.
 */
export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)(s|m|h|d)$/);
	if (!match) {
		throw new Error(`Invalid duration format: "${duration}". Use e.g. '1m', '5m', '1h', '1d'.`);
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;

	switch (unit) {
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		case "d":
			return value * 24 * 60 * 60 * 1000;
		default:
			throw new Error(`Unknown duration unit: "${unit}"`);
	}
}

/**
 * Creates a fixed-window rate limiter backed by KV.
 *
 * Each window is stored as a KV key with an expiration TTL.
 * Uses KV's eventual consistency — suitable for soft rate limiting,
 * not cryptographic precision.
 *
 * @example
 * ```ts
 * const limiter = fixedWindow({
 *   namespace: env.RATE_LIMIT_KV,
 *   limit: 100,
 *   window: '1m',
 * })
 * ```
 */
export function fixedWindow(options: FixedWindowOptions): RateLimiter {
	const { namespace, limit, window: windowStr, prefix = "rl:" } = options;
	const windowMs = parseDuration(windowStr);

	return {
		async check(key: string): Promise<RateLimitResult> {
			const now = Date.now();
			const windowStart = Math.floor(now / windowMs) * windowMs;
			const resetAt = windowStart + windowMs;
			const kvKey = `${prefix}${key}:${windowStart}`;

			const current = await namespace.get(kvKey);
			const count = current ? Number.parseInt(current, 10) : 0;

			if (count >= limit) {
				return { allowed: false, remaining: 0, resetAt };
			}

			// Increment counter with TTL equal to window duration (in seconds, rounded up)
			const ttlSeconds = Math.ceil(windowMs / 1000);
			await namespace.put(kvKey, String(count + 1), {
				expirationTtl: ttlSeconds,
			});

			return { allowed: true, remaining: limit - count - 1, resetAt };
		},
	};
}
