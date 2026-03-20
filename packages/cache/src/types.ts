/** Options for cache put operations */
export interface CachePutOptions {
  /** Time-to-live in seconds */
  ttl?: number
  /** Cache-Control header value (overrides ttl) */
  cacheControl?: string
  /** Tags for tagged invalidation */
  tags?: string[]
}

/** Options for cache get operations */
export interface CacheGetOptions {
  /** Expected response type hint */
  type?: 'text' | 'json' | 'arrayBuffer' | 'stream'
}

/** Typed cache wrapper interface */
export interface TypedCache {
  /** Store a response in the cache */
  put(key: string, response: Response, options?: CachePutOptions): Promise<void>
  /** Retrieve a response from the cache */
  get(key: string, options?: CacheGetOptions): Promise<Response | undefined>
  /** Delete a cached response */
  delete(key: string): Promise<boolean>
}

/** Configuration for cache wrapper factory */
export interface CacheConfig {
  /** Default TTL in seconds for all put operations */
  defaultTtl?: number
  /** Base URL prefix for cache keys (default: 'https://cache.local') */
  baseUrl?: string
}

/** Options for stale-while-revalidate */
export interface SWROptions<T> {
  /** Cache key */
  key: string
  /** Time-to-live in seconds — response is "fresh" for this long */
  ttl: number
  /** Serve stale for this many seconds while revalidating in background */
  staleWhileRevalidate: number
  /** Function to fetch fresh data */
  fetch: () => Promise<T>
  /** Optional cache instance to use (defaults to caches.default equivalent) */
  cache?: TypedCache
}

/** Result from stale-while-revalidate operation */
export interface SWRResult<T> {
  /** The data (fresh or stale) */
  data: T
  /** Whether the data is stale (served from cache while revalidating) */
  stale: boolean
  /** Age of the cached response in seconds (0 if freshly fetched) */
  age: number
}

/** Options for cache-aside pattern */
export interface CacheAsideOptions<T, A extends unknown[]> {
  /** Key generator function — produces cache key from arguments */
  key: (...args: A) => string
  /** Time-to-live in seconds */
  ttl: number
  /** Function to fetch data on cache miss */
  fetch: (...args: A) => Promise<T>
  /** Optional cache instance to use */
  cache?: TypedCache
}

/** Tagged cache interface */
export interface TaggedCacheInstance {
  /** Store a response with associated tags */
  put(key: string, response: Response, options?: CachePutOptions & { tags?: string[] }): Promise<void>
  /** Retrieve a response */
  get(key: string): Promise<Response | undefined>
  /** Delete a specific entry */
  delete(key: string): Promise<boolean>
  /** Invalidate all entries associated with a tag */
  invalidateTag(tag: string): Promise<number>
  /** Get all tags for a cache key */
  getTags(key: string): string[]
  /** Get all keys associated with a tag */
  getKeysByTag(tag: string): string[]
}

/** Options for tagged cache */
export interface TaggedCacheConfig {
  /** Underlying cache instance */
  cache?: TypedCache
  /** Base URL prefix for cache keys */
  baseUrl?: string
}

/** Options for in-memory cache */
export interface MemoryCacheConfig {
  /** Maximum number of entries (LRU eviction when exceeded) */
  maxSize?: number
  /** Default TTL in seconds */
  defaultTtl?: number
  /** Base URL prefix for cache keys */
  baseUrl?: string
}

/** Internal cache entry for memory cache */
export interface MemoryCacheEntry {
  response: Response
  expiresAt: number | null
  insertedAt: number
  lastAccessedAt: number
}
