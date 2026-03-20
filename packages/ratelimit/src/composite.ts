import type { CompositeRateLimiter, RateLimitResult, RateLimiter } from "./types";

/**
 * Create a composite rate limiter that checks multiple limiters in parallel.
 *
 * All limiters are checked for every request. The most restrictive
 * result is returned -- if any limiter blocks, the request is blocked.
 *
 * @param limiters - Array of RateLimiter instances to compose.
 * @returns A CompositeRateLimiter whose check() returns the strictest result.
 *
 * @example
 * ```ts
 * const limiter = composite([
 *   fixedWindow({ namespace: env.KV, limit: 100, window: '1m' }),
 *   fixedWindow({ namespace: env.KV, limit: 1000, window: '1h' }),
 * ])
 * const result = await limiter.check('user:123')
 * if (!result.allowed) return new Response('Too Many Requests', { status: 429 })
 * ```
 */
export function composite(limiters: RateLimiter[]): CompositeRateLimiter {
	return {
		async check(key: string): Promise<RateLimitResult> {
			const results = await Promise.all(limiters.map((l) => l.check(key)));

			// Find any blocked result first
			const blocked = results.find((r) => !r.allowed);
			if (blocked) {
				// Return the blocked result with the lowest remaining
				const mostRestrictive = results
					.filter((r) => !r.allowed)
					.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
				return {
					allowed: false,
					remaining: mostRestrictive.remaining,
					resetAt: earliestReset(results),
					limit: mostRestrictive.limit,
				};
			}

			// All allowed — return the most restrictive (lowest remaining)
			const mostRestrictive = results.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
			return {
				allowed: true,
				remaining: mostRestrictive.remaining,
				resetAt: earliestReset(results),
				limit: mostRestrictive.limit,
			};
		},
	};
}

function earliestReset(results: RateLimitResult[]): Date {
	return results.reduce(
		(earliest, r) => (r.resetAt.getTime() < earliest.getTime() ? r.resetAt : earliest),
		results[0].resetAt,
	);
}
