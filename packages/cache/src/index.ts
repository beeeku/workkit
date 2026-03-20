// Cache wrapper
export { cache, buildCacheUrl } from './cache'

// Stale-while-revalidate
export { swr } from './swr'

// Cache-aside pattern
export { cacheAside } from './aside'

// Tagged cache
export { taggedCache } from './tagged'

// In-memory cache
export { createMemoryCache } from './memory'

// Types
export type {
  CachePutOptions,
  CacheGetOptions,
  CacheConfig,
  TypedCache,
  SWROptions,
  SWRResult,
  CacheAsideOptions,
  TaggedCacheInstance,
  TaggedCacheConfig,
  MemoryCacheConfig,
  MemoryCacheEntry,
} from './types'
