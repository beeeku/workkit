import type { EnvSchema, InferEnv } from "@workkit/env";
import type { Context, Env } from "hono";

/**
 * Options for the workkit() middleware.
 */
export interface WorkkitOptions<T extends EnvSchema> {
	/** Environment schema to validate against on first request */
	env: T;
}

/**
 * Options for the workkitErrorHandler.
 */
export interface ErrorHandlerOptions {
	/** Include stack trace in error response (never in production) */
	includeStack?: boolean;
	/** Custom error callback for logging/reporting */
	onError?: (err: Error, c: Context) => void | Promise<void>;
}

/**
 * A rate limiter instance that checks whether a key is allowed.
 */
export interface RateLimiter {
	/** Check if the key is allowed. Returns { allowed, remaining, resetAt } */
	check(key: string): Promise<RateLimitResult>;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Remaining requests in the current window */
	remaining: number;
	/** When the window resets (ms since epoch) */
	resetAt: number;
}

/**
 * Options for the rateLimit middleware.
 */
export interface RateLimitOptions {
	/** The rate limiter implementation */
	limiter: RateLimiter;
	/** Function to extract the rate limit key from context (e.g., IP address) */
	keyFn: (c: Context) => string | Promise<string>;
	/** Custom response when rate limited (optional) */
	onRateLimited?: (c: Context, result: RateLimitResult) => Response | Promise<Response>;
}

/**
 * Options for fixed-window rate limiter.
 */
export interface FixedWindowOptions {
	/** KV namespace for storing counters */
	namespace: KVNamespace;
	/** Maximum requests per window */
	limit: number;
	/** Window duration — e.g. '1m', '5m', '1h', '1d' */
	window: string;
	/** Optional prefix for KV keys */
	prefix?: string;
}

/**
 * Options for the cacheResponse middleware.
 */
export interface CacheOptions {
	/** Cache TTL in seconds */
	ttl: number;
	/** Function to generate the cache key (defaults to request URL) */
	keyFn?: (c: Context) => string;
	/** Cache API instance (defaults to caches.default) */
	cache?: Cache;
	/** HTTP methods to cache (defaults to ['GET']) */
	methods?: string[];
}

/**
 * Hono environment type with workkit context variables.
 */
export interface WorkkitEnv<T extends EnvSchema = EnvSchema> extends Env {
	Variables: {
		"workkit:env": InferEnv<T>;
		"workkit:envValidated": boolean;
	};
}
