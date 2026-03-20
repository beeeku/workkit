import { parseDuration } from "./duration";
import type {
	RateLimitResult,
	TokenBucketOptions,
	TokenBucketState,
	TokenRateLimiter,
} from "./types";

/**
 * Create a token bucket rate limiter backed by KV.
 *
 * Starts with a full bucket of tokens. Each request consumes tokens.
 * Tokens are refilled at a fixed rate over time, up to the capacity.
 * Allows burst traffic up to the bucket capacity.
 *
 * @example
 * ```ts
 * const limiter = tokenBucket({
 *   namespace: env.RATE_LIMIT_KV,
 *   capacity: 10,
 *   refillRate: 1,
 *   refillInterval: '1s',
 * })
 * const result = await limiter.consume('user:123', 1)
 * ```
 *
 * @remarks
 * This implementation provides approximate rate limiting suitable for most use cases.
 * Under high concurrent load from multiple Workers, the actual limit may be briefly
 * exceeded due to KV's eventually-consistent model. For strict mutual exclusion,
 * use Durable Objects as the backing store.
 */
export function tokenBucket(options: TokenBucketOptions): TokenRateLimiter {
	const refillIntervalMs = parseDuration(options.refillInterval);
	const prefix = options.prefix ?? "rl:tb:";

	return {
		async consume(key: string, tokens = 1): Promise<RateLimitResult> {
			const now = Date.now();
			const kvKey = `${prefix}${key}`;

			const existing = (await options.namespace.get(kvKey, "json")) as TokenBucketState | null;

			let currentTokens: number;
			let lastRefill: number;

			if (existing) {
				// Calculate refilled tokens since last access
				const elapsed = now - existing.lastRefill;
				const refillIntervals = Math.floor(elapsed / refillIntervalMs);
				const refilledTokens = refillIntervals * options.refillRate;
				currentTokens = Math.min(options.capacity, existing.tokens + refilledTokens);
				lastRefill = existing.lastRefill + refillIntervals * refillIntervalMs;
			} else {
				// Fresh bucket starts full
				currentTokens = options.capacity;
				lastRefill = now;
			}

			const allowed = tokens <= currentTokens;
			let remaining: number;

			if (allowed) {
				currentTokens -= tokens;
				remaining = currentTokens;
			} else {
				// Don't consume tokens on failure
				remaining = Math.max(0, currentTokens);
			}

			const state: TokenBucketState = {
				tokens: currentTokens,
				lastRefill,
			};

			await options.namespace.put(kvKey, JSON.stringify(state));

			// Calculate when the next token will be available
			const tokensNeeded = allowed ? 1 : tokens - currentTokens;
			const refillTime = Math.ceil(tokensNeeded / options.refillRate) * refillIntervalMs;
			const resetAt = new Date(now + refillTime);

			return { allowed, remaining, resetAt, limit: options.capacity };
		},
	};
}
