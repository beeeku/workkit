import type { SWROptions, SWRResult, TypedCache } from './types'
import { createMemoryCache } from './memory'

const SWR_METADATA_PREFIX = '__swr_meta__'
const DEFAULT_CACHE = createMemoryCache()

/**
 * Stale-while-revalidate cache pattern.
 *
 * Returns cached data immediately (even if stale) while revalidating in the background.
 * If no cached data exists, fetches fresh data and caches it.
 *
 * @example
 * ```ts
 * const result = await swr({
 *   key: '/api/users',
 *   ttl: 300,
 *   staleWhileRevalidate: 3600,
 *   async fetch() {
 *     return await fetchUsersFromDB()
 *   },
 * })
 * // result.data — the data
 * // result.stale — whether data was served from stale cache
 * // result.age — age in seconds
 * ```
 */
export async function swr<T>(options: SWROptions<T>): Promise<SWRResult<T>> {
  const { key, ttl, staleWhileRevalidate, fetch: fetchFn, cache: cacheInstance } = options
  const c = cacheInstance ?? DEFAULT_CACHE

  // Try to get cached response
  const cached = await c.get(key)

  if (cached) {
    const metaResponse = await c.get(`${SWR_METADATA_PREFIX}${key}`)
    let storedAt = 0
    if (metaResponse) {
      try {
        const meta = await metaResponse.json() as { storedAt: number }
        storedAt = meta.storedAt
      } catch {
        // Metadata corrupted, treat as miss
      }
    }

    const now = Date.now()
    const ageMs = now - storedAt
    const ageSec = Math.floor(ageMs / 1000)
    const isFresh = ageSec < ttl
    const isStaleButValid = ageSec < ttl + staleWhileRevalidate

    if (isFresh) {
      // Fresh — return directly
      const data = await cached.json() as T
      return { data, stale: false, age: ageSec }
    }

    if (isStaleButValid) {
      // Stale but within revalidation window — serve stale and revalidate
      const data = await cached.json() as T

      // Fire-and-forget revalidation
      revalidate(key, ttl, fetchFn, c).catch(() => {
        // Swallow revalidation errors — stale data is already served
      })

      return { data, stale: true, age: ageSec }
    }

    // Beyond stale window — treat as miss
  }

  // Cache miss — fetch fresh
  const data = await fetchFn()
  await storeWithMeta(key, data, ttl, c)
  return { data, stale: false, age: 0 }
}

async function revalidate<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
  cache: TypedCache,
): Promise<void> {
  const data = await fetchFn()
  await storeWithMeta(key, data, ttl, cache)
}

async function storeWithMeta<T>(
  key: string,
  data: T,
  ttl: number,
  cache: TypedCache,
): Promise<void> {
  const response = new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })

  // Store with a long TTL (ttl + generous buffer) to keep stale data available
  await cache.put(key, response, { ttl: ttl * 10 })

  // Store metadata with the timestamp
  const meta = new Response(JSON.stringify({ storedAt: Date.now() }), {
    headers: { 'Content-Type': 'application/json' },
  })
  await cache.put(`${SWR_METADATA_PREFIX}${key}`, meta, { ttl: ttl * 10 })
}
