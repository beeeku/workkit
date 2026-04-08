import { ConfigError } from "@workkit/errors";
import type { AiInput, AiOutput, CacheConfig, CachedGateway, Gateway, RunOptions } from "./types";

/** Default hash function: deterministic JSON stringify */
function defaultHashFn(model: string, input: AiInput): string {
	return `ai-cache:${model}:${stableStringify(input)}`;
}

/** Stable JSON.stringify — sorts object keys for determinism */
function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const sorted = Object.keys(value as Record<string, unknown>).sort();
	const entries = sorted.map(
		(k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
	);
	return `{${entries.join(",")}}`;
}

/**
 * Wrap a gateway with response caching.
 *
 * Identical requests (same model + input) return cached responses
 * without calling the provider. Uses a KV namespace for storage.
 *
 * @example
 * ```ts
 * const cachedGw = withCache(gateway, {
 *   storage: env.AI_CACHE_KV,
 *   ttl: 3600,
 * })
 *
 * const r1 = await cachedGw.run('gpt-4', input)  // API call
 * const r2 = await cachedGw.run('gpt-4', input)  // cache hit
 * ```
 */
export function withCache(gateway: Gateway, config: CacheConfig): CachedGateway {
	if (!config.storage) {
		throw new ConfigError("Cache requires a storage binding", {
			context: { storage: config.storage },
		});
	}

	const ttl = config.ttl ?? 3600;
	const hashFn = config.hashFn ?? defaultHashFn;

	function getCacheKey(model: string, input: AiInput): string {
		return hashFn(model, input);
	}

	return {
		async run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput> {
			const cacheKey = getCacheKey(model, input);

			// Try cache first
			const cached = await config.storage.get(cacheKey, { type: "text" });
			if (cached !== null) {
				try {
					const parsed = JSON.parse(cached) as AiOutput;
					return parsed;
				} catch {
					// Corrupted cache entry — fall through to provider
				}
			}

			// Cache miss — call provider
			const result = await gateway.run(model, input, options);

			// Store in cache (fire and forget — don't block on cache write)
			await config.storage.put(cacheKey, JSON.stringify(result), {
				expirationTtl: ttl,
			});

			return result;
		},

		async isCached(model: string, input: AiInput): Promise<boolean> {
			const cacheKey = getCacheKey(model, input);
			const value = await config.storage.get(cacheKey, { type: "text" });
			return value !== null;
		},

		async invalidate(model: string, input: AiInput): Promise<void> {
			const cacheKey = getCacheKey(model, input);
			await config.storage.delete(cacheKey);
		},

		providers(): string[] {
			return gateway.providers();
		},

		defaultProvider(): string {
			return gateway.defaultProvider();
		},
	};
}
