# @workkit/cache

> Cache API wrapper with SWR, cache-aside, tagged invalidation, and in-memory fallback

[![npm](https://img.shields.io/npm/v/@workkit/cache)](https://www.npmjs.com/package/@workkit/cache)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/cache)](https://bundlephobia.com/package/@workkit/cache)

## Install

```bash
bun add @workkit/cache
```

## Usage

### Before (raw Cache API)

```ts
// Manual URL construction, manual Cache-Control, no SWR
const cacheKey = new Request("https://cache.local/api/users")
const cache = await caches.open("my-app")
const cached = await cache.match(cacheKey)
if (cached) return cached

const response = await fetchFromDB()
const cloned = response.clone()
cloned.headers.set("Cache-Control", "public, max-age=300")
await cache.put(cacheKey, cloned)
return response
```

### After (workkit cache)

```ts
import { cache, swr, cacheAside, taggedCache } from "@workkit/cache"

// Simple cache wrapper
const appCache = cache("my-app", { defaultTtl: 300 })
await appCache.put("/api/users", response)
const cached = await appCache.get("/api/users")

// Stale-while-revalidate — serve stale, refresh in background
const result = await swr({
  key: "/api/users",
  ttl: 300,
  staleWhileRevalidate: 3600,
  async fetch() {
    return await db.query("SELECT * FROM users")
  },
})
// result.data — the data
// result.stale — whether served from stale cache
// result.age — cache age in seconds

// Cache-aside — automatic get-or-fetch
const user = await cacheAside({
  cache: appCache,
  key: `/users/${id}`,
  ttl: 600,
  fetch: () => db.getUser(id),
})

// Tagged cache — invalidate by tag
const tagged = taggedCache({ cache: appCache })
await tagged.put("/api/users/123", response, { tags: ["users", "user:123"] })
await tagged.invalidateTag("users") // Purge all user-related cache
```

## API

### Cache Wrapper

- **`cache(name, config?)`** — Create a typed cache wrapper around the Cache API
  - `.get(key)`, `.put(key, response, opts?)`, `.delete(key)`, `.has(key)`

### Stale-While-Revalidate

- **`swr<T>(options)`** — Returns `{ data, stale, age }`. Options: `key`, `ttl`, `staleWhileRevalidate`, `fetch`

### Cache-Aside

- **`cacheAside<T>(options)`** — Get from cache or fetch and cache. Options: `cache`, `key`, `ttl`, `fetch`

### Tagged Cache

- **`taggedCache(config)`** — Cache with tag-based invalidation
  - `.put(key, response, { tags })`, `.get(key)`, `.invalidateTag(tag)`

### In-Memory Cache

- **`createMemoryCache(config?)`** — In-memory LRU cache for short-lived data

## License

MIT
