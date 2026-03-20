import type { MemoryCacheConfig, MemoryCacheEntry, TypedCache, CachePutOptions, CacheGetOptions } from './types'
import { buildCacheUrl } from './cache'

const DEFAULT_MAX_SIZE = 1000
const DEFAULT_BASE_URL = 'https://cache.local'

/**
 * Create an in-memory cache with LRU eviction.
 * Implements the same TypedCache interface as the Cache API wrapper.
 * Ideal for local development, testing, and edge cases where the Cache API isn't available.
 *
 * @example
 * ```ts
 * const memCache = createMemoryCache({ maxSize: 100 })
 * await memCache.put('/api/data', new Response('hello'), { ttl: 60 })
 * const cached = await memCache.get('/api/data')
 * ```
 */
export function createMemoryCache(config?: MemoryCacheConfig): TypedCache & {
  /** Current number of entries */
  readonly size: number
  /** Clear all entries */
  clear(): void
  /** Check if a key exists (without updating LRU) */
  has(key: string): boolean
} {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE
  const defaultTtl = config?.defaultTtl
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL
  const entries = new Map<string, MemoryCacheEntry>()

  function isExpired(entry: MemoryCacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  function evictLRU(): void {
    if (entries.size <= maxSize) return

    // Find the least-recently-accessed entry
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of entries) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt
        oldestKey = key
      }
    }

    if (oldestKey !== null) {
      entries.delete(oldestKey)
    }
  }

  function cleanExpired(): void {
    for (const [key, entry] of entries) {
      if (isExpired(entry)) {
        entries.delete(key)
      }
    }
  }

  function parseTtl(options?: CachePutOptions): number | null {
    if (options?.ttl !== undefined) return options.ttl
    if (options?.cacheControl) {
      const match = options.cacheControl.match(/max-age=(\d+)/)
      if (match) return parseInt(match[1], 10)
    }
    if (defaultTtl !== undefined) return defaultTtl
    return null
  }

  return {
    get size() {
      cleanExpired()
      return entries.size
    },

    async put(key: string, response: Response, options?: CachePutOptions): Promise<void> {
      const url = buildCacheUrl(key, baseUrl)
      const ttl = parseTtl(options)
      const now = Date.now()

      // Clone the response so the original remains usable
      const cloned = response.clone()

      entries.set(url, {
        response: cloned,
        expiresAt: ttl !== null ? now + ttl * 1000 : null,
        insertedAt: now,
        lastAccessedAt: now,
      })

      // Evict if over capacity
      if (entries.size > maxSize) {
        evictLRU()
      }
    },

    async get(key: string, _options?: CacheGetOptions): Promise<Response | undefined> {
      const url = buildCacheUrl(key, baseUrl)
      const entry = entries.get(url)

      if (!entry) return undefined

      if (isExpired(entry)) {
        entries.delete(url)
        return undefined
      }

      // Update LRU timestamp
      entry.lastAccessedAt = Date.now()
      // Return a clone so the stored response remains usable
      return entry.response.clone()
    },

    async delete(key: string): Promise<boolean> {
      const url = buildCacheUrl(key, baseUrl)
      return entries.delete(url)
    },

    clear(): void {
      entries.clear()
    },

    has(key: string): boolean {
      const url = buildCacheUrl(key, baseUrl)
      const entry = entries.get(url)
      if (!entry) return false
      if (isExpired(entry)) {
        entries.delete(url)
        return false
      }
      return true
    },
  }
}
