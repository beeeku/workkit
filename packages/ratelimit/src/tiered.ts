import { ValidationError } from "@workkit/errors";
import { fixedWindow } from "./fixed-window";
import { slidingWindow } from "./sliding-window";
import type { RateLimitResult, RateLimiter, TieredOptions, TieredRateLimiter } from "./types";

/**
 * Create a tiered rate limiter that applies different limits per tier.
 *
 * Each tier (e.g. "free", "pro", "enterprise") gets its own limit.
 * Tiers with `Number.POSITIVE_INFINITY` limit short-circuit without touching KV.
 *
 * @example
 * ```ts
 * const limiter = tiered({
 *   namespace: env.RATE_LIMIT_KV,
 *   tiers: { free: { limit: 100 }, pro: { limit: 10000 }, enterprise: { limit: Number.POSITIVE_INFINITY } },
 *   window: '1h',
 * })
 * const result = await limiter.check('user:123', 'free')
 * ```
 */
export function tiered(options: TieredOptions): TieredRateLimiter {
	const algorithm = options.algorithm ?? "fixed";
	const prefix = options.prefix ?? "rl:tiered:";
	const limiterCache = new Map<string, RateLimiter>();

	function getLimiter(tierName: string, limit: number): RateLimiter {
		const cacheKey = `${tierName}:${limit}`;
		let limiter = limiterCache.get(cacheKey);
		if (!limiter) {
			const opts = {
				namespace: options.namespace,
				limit,
				window: options.window,
				prefix: `${prefix}${tierName}:`,
			};
			limiter = algorithm === "sliding" ? slidingWindow(opts) : fixedWindow(opts);
			limiterCache.set(cacheKey, limiter);
		}
		return limiter;
	}

	function resolveTier(tier: string): { name: string; limit: number } {
		const config = options.tiers[tier];
		if (config) {
			return { name: tier, limit: config.limit };
		}
		if (options.defaultTier) {
			const defaultConfig = options.tiers[options.defaultTier];
			if (defaultConfig) {
				return { name: options.defaultTier, limit: defaultConfig.limit };
			}
		}
		throw new ValidationError("tier", [
			{
				path: ["tier"],
				message: `Unknown tier "${tier}" and no defaultTier configured`,
			},
		]);
	}

	return {
		async check(key: string, tier: string): Promise<RateLimitResult> {
			const resolved = resolveTier(tier);

			// Short-circuit for unlimited tiers
			if (resolved.limit === Number.POSITIVE_INFINITY) {
				return {
					allowed: true,
					remaining: Number.POSITIVE_INFINITY,
					resetAt: new Date(0),
					limit: Number.POSITIVE_INFINITY,
				};
			}

			return getLimiter(resolved.name, resolved.limit).check(key);
		},

		forTier(tier: string): RateLimiter {
			const resolved = resolveTier(tier);
			if (resolved.limit === Number.POSITIVE_INFINITY) {
				return {
					async check(_key: string): Promise<RateLimitResult> {
						return {
							allowed: true,
							remaining: Number.POSITIVE_INFINITY,
							resetAt: new Date(0),
							limit: Number.POSITIVE_INFINITY,
						};
					},
				};
			}
			return getLimiter(resolved.name, resolved.limit);
		},
	};
}
