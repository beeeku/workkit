import { createMemoryCache } from "./memory";
import type { CacheAsideOptions } from "./types";

const DEFAULT_CACHE = createMemoryCache();

/**
 * Cache-aside pattern with typed return values.
 *
 * Creates a function that transparently caches results.
 * On cache miss, calls the fetch function, caches the result, and returns it.
 * On cache hit, returns the cached result directly.
 *
 * @example
 * ```ts
 * const getUser = cacheAside<User>({
 *   key: (id: string) => `/users/${id}`,
 *   ttl: 600,
 *   async fetch(id: string) {
 *     return await db.first('users', { where: { id } })
 *   },
 * })
 *
 * const user = await getUser('123')  // fetches & caches
 * const same = await getUser('123')  // returns cached
 * ```
 */
export function cacheAside<T, A extends unknown[] = [string]>(
	options: CacheAsideOptions<T, A>,
): (...args: A) => Promise<T> {
	const { key: keyFn, ttl, fetch: fetchFn, cache: cacheInstance } = options;
	const c = cacheInstance ?? DEFAULT_CACHE;

	return async (...args: A): Promise<T> => {
		const cacheKey = keyFn(...args);

		// Try cache first
		const cached = await c.get(cacheKey);
		if (cached) {
			const data = (await cached.json()) as T;
			return data;
		}

		// Cache miss — fetch
		const data = await fetchFn(...args);

		// Store in cache
		const response = new Response(JSON.stringify(data), {
			headers: { "Content-Type": "application/json" },
		});
		await c.put(cacheKey, response, { ttl });

		return data;
	};
}
