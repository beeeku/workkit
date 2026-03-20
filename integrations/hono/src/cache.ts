import type { MiddlewareHandler } from "hono";
import type { CacheOptions } from "./types";

/**
 * Cache middleware for Hono — caches responses using the Cache API.
 *
 * Only caches successful (2xx) responses. Serves cached responses on cache hit.
 * Uses Cloudflare's Cache API by default.
 *
 * @example
 * ```ts
 * app.get('/api/data', cacheResponse({ ttl: 300 }), async (c) => {
 *   return c.json(await fetchData())
 * })
 * ```
 */
export function cacheResponse(options: CacheOptions): MiddlewareHandler {
	const { ttl, keyFn, methods = ["GET"] } = options;

	return async (c, next) => {
		// Only cache specified methods
		if (!methods.includes(c.req.method)) {
			await next();
			return;
		}

		const cacheKey = keyFn ? keyFn(c) : c.req.url;
		const cacheRequest = new Request(cacheKey);

		// Try to get the cache instance
		const cache = options.cache ?? (typeof caches !== "undefined" ? caches.default : null);
		if (!cache) {
			// No cache available, skip caching
			await next();
			return;
		}

		// Check for cached response
		const cached = await cache.match(cacheRequest);
		if (cached) {
			return cached;
		}

		// Execute handler
		await next();

		// Only cache successful responses
		const response = c.res;
		if (response.status >= 200 && response.status < 300) {
			// Clone the response and add cache headers
			const cloned = response.clone();
			const cachedResponse = new Response(cloned.body, {
				status: cloned.status,
				statusText: cloned.statusText,
				headers: new Headers(cloned.headers),
			});
			cachedResponse.headers.set("Cache-Control", `s-maxage=${ttl}`);

			// Store in cache — use waitUntil if available, otherwise await directly
			const putPromise = cache.put(cacheRequest, cachedResponse);
			try {
				c.executionCtx.waitUntil(putPromise);
			} catch {
				// executionCtx not available (e.g., in tests), await directly
				await putPromise;
			}
		}
	};
}
