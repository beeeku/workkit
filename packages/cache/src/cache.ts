import type { CacheConfig, CachePutOptions, CacheGetOptions, TypedCache } from './types'

const DEFAULT_BASE_URL = 'https://cache.local'

/**
 * Build a fully-qualified cache URL from a key and base URL.
 * If the key is already a full URL, use it as-is.
 */
export function buildCacheUrl(key: string, baseUrl: string): string {
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }
  const normalizedKey = key.startsWith('/') ? key : `/${key}`
  return `${baseUrl}${normalizedKey}`
}

/**
 * Build Cache-Control header from options.
 */
function buildCacheControl(options?: CachePutOptions, defaultTtl?: number): string | undefined {
  if (options?.cacheControl) {
    return options.cacheControl
  }
  const ttl = options?.ttl ?? defaultTtl
  if (ttl !== undefined) {
    return `public, max-age=${ttl}`
  }
  return undefined
}

/**
 * Create a typed cache wrapper around a Cache API instance.
 *
 * @param nameOrCache - Cache name string or an existing Cache API instance
 * @param config - Optional configuration
 * @returns TypedCache wrapper
 *
 * @example
 * ```ts
 * const appCache = cache('my-app')
 * await appCache.put('/api/users', response, { ttl: 300 })
 * const cached = await appCache.get('/api/users')
 * ```
 */
export function cache(nameOrCache: string | Cache, config?: CacheConfig): TypedCache {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL
  const defaultTtl = config?.defaultTtl

  let cacheInstance: Cache | null = null
  let cacheName: string | null = null

  if (typeof nameOrCache === 'string') {
    cacheName = nameOrCache
  } else {
    cacheInstance = nameOrCache
  }

  async function getCache(): Promise<Cache> {
    if (cacheInstance) return cacheInstance
    // Use the global caches API to open a named cache
    cacheInstance = await caches.open(cacheName!)
    return cacheInstance
  }

  return {
    async put(key: string, response: Response, options?: CachePutOptions): Promise<void> {
      const url = buildCacheUrl(key, baseUrl)
      const cacheControl = buildCacheControl(options, defaultTtl)

      // Clone the response and add cache headers
      const headers = new Headers(response.headers)
      if (cacheControl) {
        headers.set('Cache-Control', cacheControl)
      }

      const cachedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })

      const c = await getCache()
      await c.put(url, cachedResponse)
    },

    async get(key: string, _options?: CacheGetOptions): Promise<Response | undefined> {
      const url = buildCacheUrl(key, baseUrl)
      const c = await getCache()
      const response = await c.match(url)
      return response ?? undefined
    },

    async delete(key: string): Promise<boolean> {
      const url = buildCacheUrl(key, baseUrl)
      const c = await getCache()
      return c.delete(url)
    },
  }
}
