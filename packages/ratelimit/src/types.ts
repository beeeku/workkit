/** Result returned by all rate limiter check/consume operations */
export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Number of remaining requests in the current window / tokens remaining */
	remaining: number;
	/** When the rate limit resets */
	resetAt: Date;
	/** The configured limit (max requests or token capacity) */
	limit: number;
}

/** Duration string — e.g. '1s', '5m', '1h', '1d' */
export type Duration = `${number}${"s" | "m" | "h" | "d"}`;

/** Options for fixed window rate limiter */
export interface FixedWindowOptions {
	/** KV namespace to store rate limit counters */
	namespace: KVNamespace;
	/** Maximum number of requests per window */
	limit: number;
	/** Window duration */
	window: Duration;
	/** Optional key prefix for KV entries */
	prefix?: string;
}

/** Options for sliding window rate limiter */
export interface SlidingWindowOptions {
	/** KV namespace to store rate limit counters */
	namespace: KVNamespace;
	/** Maximum number of requests per window */
	limit: number;
	/** Window duration */
	window: Duration;
	/** Optional key prefix for KV entries */
	prefix?: string;
}

/** Options for token bucket rate limiter */
export interface TokenBucketOptions {
	/** KV namespace to store bucket state */
	namespace: KVNamespace;
	/** Maximum number of tokens */
	capacity: number;
	/** Number of tokens added per refill interval */
	refillRate: number;
	/** How often tokens are refilled */
	refillInterval: Duration;
	/** Optional key prefix for KV entries */
	prefix?: string;
}

/** A rate limiter that checks request counts */
export interface RateLimiter {
	/** Check if a request is allowed for the given key */
	check(key: string): Promise<RateLimitResult>;
}

/** A token-based rate limiter that consumes tokens */
export interface TokenRateLimiter {
	/** Consume tokens for the given key */
	consume(key: string, tokens?: number): Promise<RateLimitResult>;
}

/** A composite rate limiter that checks multiple limiters */
export interface CompositeRateLimiter {
	/** Check all limiters and return the most restrictive result */
	check(key: string): Promise<RateLimitResult>;
}

/** Internal KV state for fixed window */
export interface FixedWindowState {
	count: number;
	windowStart: number;
}

/** Internal KV state for sliding window */
export interface SlidingWindowState {
	count: number;
	windowStart: number;
}

/** Internal KV state for token bucket */
export interface TokenBucketState {
	tokens: number;
	lastRefill: number;
}

/** Options for tiered rate limiter */
export interface TieredOptions {
	namespace: KVNamespace;
	tiers: Record<string, TierConfig>;
	window: Duration;
	defaultTier?: string;
	algorithm?: "fixed" | "sliding";
	prefix?: string;
}

/** Configuration for a single tier */
export interface TierConfig {
	limit: number;
}

/** A tiered rate limiter with per-tier checks */
export interface TieredRateLimiter {
	check(key: string, tier: string): Promise<RateLimitResult>;
	forTier(tier: string): RateLimiter;
}
