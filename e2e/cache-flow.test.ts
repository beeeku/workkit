import { describe, it, expect } from 'vitest'
import { swr, cacheAside, taggedCache, createMemoryCache } from '@workkit/cache'

describe('Cache patterns E2E', () => {
  describe('stale-while-revalidate (SWR)', () => {
    it('fetches fresh data on cache miss', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      const result = await swr({
        key: '/api/users',
        ttl: 300,
        staleWhileRevalidate: 600,
        cache,
        async fetch() {
          fetchCount++
          return [{ id: 1, name: 'Alice' }]
        },
      })

      expect(result.data).toEqual([{ id: 1, name: 'Alice' }])
      expect(result.stale).toBe(false)
      expect(result.age).toBe(0)
      expect(fetchCount).toBe(1)
    })

    it('returns fresh data from cache on subsequent calls', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()
      const fetchFn = async () => {
        fetchCount++
        return { value: fetchCount }
      }

      // First call - cache miss
      await swr({ key: '/data', ttl: 300, staleWhileRevalidate: 600, cache, fetch: fetchFn })
      expect(fetchCount).toBe(1)

      // Second call - should use cache
      const result2 = await swr({ key: '/data', ttl: 300, staleWhileRevalidate: 600, cache, fetch: fetchFn })
      expect(result2.data.value).toBe(1) // Cached value from first fetch
      expect(result2.stale).toBe(false)
    })

    it('returns stale data and revalidates in background', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      // Store with a very short TTL so it becomes stale immediately
      const response = new Response(JSON.stringify({ old: true }))
      await cache.put('/stale-key', response, { ttl: 0 }) // immediate expiry TTL=0

      // Store metadata with old timestamp
      const meta = new Response(JSON.stringify({ storedAt: Date.now() - 400_000 })) // 400s ago > 300s TTL
      await cache.put('__swr_meta__/stale-key', meta, { ttl: 99999 })

      const result = await swr({
        key: '/stale-key',
        ttl: 300,
        staleWhileRevalidate: 600,
        cache,
        async fetch() {
          fetchCount++
          return { fresh: true }
        },
      })

      expect(result.stale).toBe(true)
      expect(result.data).toEqual({ old: true })
      // Give time for background revalidation
      await new Promise((r) => setTimeout(r, 50))
      expect(fetchCount).toBe(1) // revalidation happened
    })

    it('fetches fresh on expired stale data (beyond SWR window)', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      // Store with old metadata (beyond ttl + staleWhileRevalidate)
      const response = new Response(JSON.stringify({ expired: true }))
      await cache.put('/expired-key', response, { ttl: 99999 })

      const meta = new Response(JSON.stringify({ storedAt: Date.now() - 2_000_000 }))
      await cache.put('__swr_meta__/expired-key', meta, { ttl: 99999 })

      const result = await swr({
        key: '/expired-key',
        ttl: 300,
        staleWhileRevalidate: 600,
        cache,
        async fetch() {
          fetchCount++
          return { fresh: true }
        },
      })

      // Beyond stale window, should re-fetch
      expect(result.data).toEqual({ fresh: true })
      expect(result.stale).toBe(false)
      expect(fetchCount).toBe(1)
    })
  })

  describe('cache-aside pattern', () => {
    it('fetches and caches on first call', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      const getUser = cacheAside<{ id: string; name: string }, [string]>({
        key: (id) => `/users/${id}`,
        ttl: 600,
        cache,
        async fetch(id) {
          fetchCount++
          return { id, name: `User ${id}` }
        },
      })

      const user = await getUser('42')
      expect(user).toEqual({ id: '42', name: 'User 42' })
      expect(fetchCount).toBe(1)
    })

    it('returns cached data on subsequent calls', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      const getUser = cacheAside<{ id: string; name: string }, [string]>({
        key: (id) => `/users/${id}`,
        ttl: 600,
        cache,
        async fetch(id) {
          fetchCount++
          return { id, name: `User ${id}` }
        },
      })

      await getUser('42')
      await getUser('42')
      await getUser('42')

      expect(fetchCount).toBe(1) // Only one actual fetch
    })

    it('different keys trigger separate fetches', async () => {
      let fetchCount = 0
      const cache = createMemoryCache()

      const getUser = cacheAside<{ id: string }, [string]>({
        key: (id) => `/users/${id}`,
        ttl: 600,
        cache,
        async fetch(id) {
          fetchCount++
          return { id }
        },
      })

      await getUser('1')
      await getUser('2')
      await getUser('3')
      expect(fetchCount).toBe(3)

      // Repeated calls use cache
      await getUser('1')
      await getUser('2')
      expect(fetchCount).toBe(3) // No additional fetches
    })

    it('cache-aside with complex key generation', async () => {
      const cache = createMemoryCache()

      const getReport = cacheAside<{ total: number }, [string, string]>({
        key: (type, date) => `/reports/${type}/${date}`,
        ttl: 3600,
        cache,
        async fetch(type, date) {
          return { total: type === 'sales' ? 1000 : 500 }
        },
      })

      const sales = await getReport('sales', '2024-01-01')
      expect(sales.total).toBe(1000)

      const ops = await getReport('ops', '2024-01-01')
      expect(ops.total).toBe(500)
    })
  })

  describe('tagged cache invalidation', () => {
    it('stores and retrieves tagged entries', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response(JSON.stringify({ name: 'Alice' })), {
        tags: ['user:1', 'users'],
      })

      const cached = await tc.get('/users/1')
      expect(cached).toBeDefined()
      const data = await cached!.json()
      expect(data).toEqual({ name: 'Alice' })
    })

    it('invalidates all entries with a tag', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response(JSON.stringify({ name: 'Alice' })), {
        tags: ['user:1', 'users'],
      })
      await tc.put('/users/2', new Response(JSON.stringify({ name: 'Bob' })), {
        tags: ['user:2', 'users'],
      })
      await tc.put('/posts/1', new Response(JSON.stringify({ title: 'Hello' })), {
        tags: ['post:1', 'posts'],
      })

      // Invalidate all users
      const count = await tc.invalidateTag('users')
      expect(count).toBe(2)

      // Users are gone
      expect(await tc.get('/users/1')).toBeUndefined()
      expect(await tc.get('/users/2')).toBeUndefined()

      // Posts are still there
      const post = await tc.get('/posts/1')
      expect(post).toBeDefined()
    })

    it('invalidates only specific entries', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response(JSON.stringify({ name: 'Alice' })), {
        tags: ['user:1', 'users'],
      })
      await tc.put('/users/2', new Response(JSON.stringify({ name: 'Bob' })), {
        tags: ['user:2', 'users'],
      })

      // Invalidate only user:1
      const count = await tc.invalidateTag('user:1')
      expect(count).toBe(1)

      expect(await tc.get('/users/1')).toBeUndefined()
      expect(await tc.get('/users/2')).toBeDefined()
    })

    it('getTags returns tags for a key', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response('data'), {
        tags: ['user:1', 'users', 'active'],
      })

      const tags = tc.getTags('/users/1')
      expect(tags).toContain('user:1')
      expect(tags).toContain('users')
      expect(tags).toContain('active')
    })

    it('getKeysByTag returns all keys for a tag', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response('1'), { tags: ['users'] })
      await tc.put('/users/2', new Response('2'), { tags: ['users'] })
      await tc.put('/users/3', new Response('3'), { tags: ['users'] })

      const keys = tc.getKeysByTag('users')
      expect(keys).toHaveLength(3)
    })

    it('delete removes a single entry and its tag mappings', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response('1'), { tags: ['users'] })
      await tc.put('/users/2', new Response('2'), { tags: ['users'] })

      await tc.delete('/users/1')

      expect(await tc.get('/users/1')).toBeUndefined()
      expect(tc.getTags('/users/1')).toEqual([])
      expect(tc.getKeysByTag('users')).toHaveLength(1)
    })

    it('re-putting a key updates its tags', async () => {
      const tc = taggedCache()

      await tc.put('/users/1', new Response('v1'), { tags: ['users', 'old'] })
      await tc.put('/users/1', new Response('v2'), { tags: ['users', 'new'] })

      const tags = tc.getTags('/users/1')
      expect(tags).toContain('users')
      expect(tags).toContain('new')
      expect(tags).not.toContain('old')
    })

    it('invalidating non-existent tag returns 0', async () => {
      const tc = taggedCache()
      const count = await tc.invalidateTag('nonexistent')
      expect(count).toBe(0)
    })
  })

  describe('memory cache', () => {
    it('put and get roundtrip', async () => {
      const cache = createMemoryCache()
      await cache.put('/key', new Response('value'))

      const cached = await cache.get('/key')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('value')
    })

    it('returns undefined for missing keys', async () => {
      const cache = createMemoryCache()
      const result = await cache.get('/nonexistent')
      expect(result).toBeUndefined()
    })

    it('delete removes entries', async () => {
      const cache = createMemoryCache()
      await cache.put('/key', new Response('value'))
      const deleted = await cache.delete('/key')
      expect(deleted).toBe(true)

      const result = await cache.get('/key')
      expect(result).toBeUndefined()
    })

    it('TTL-based expiration', async () => {
      const cache = createMemoryCache()
      await cache.put('/temp', new Response('temp'), { ttl: 0 }) // 0 second TTL

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 10))
      const result = await cache.get('/temp')
      expect(result).toBeUndefined()
    })

    it('LRU eviction when over capacity', async () => {
      const cache = createMemoryCache({ maxSize: 3 })

      await cache.put('/a', new Response('a'))
      await cache.put('/b', new Response('b'))
      await cache.put('/c', new Response('c'))

      // All 3 should exist
      expect(cache.size).toBe(3)

      // Add /d, which exceeds maxSize and should evict the least recently used
      await cache.put('/d', new Response('d'))

      // Size should be back to 3 after eviction
      expect(cache.size).toBe(3)

      // /d should definitely be present (just added)
      expect(await cache.get('/d')).toBeDefined()

      // One of the original three was evicted
      const aExists = (await cache.get('/a')) !== undefined
      const bExists = (await cache.get('/b')) !== undefined
      const cExists = (await cache.get('/c')) !== undefined

      const surviving = [aExists, bExists, cExists].filter(Boolean).length
      expect(surviving).toBe(2) // exactly one was evicted
    })

    it('clear removes all entries', async () => {
      const cache = createMemoryCache()
      await cache.put('/a', new Response('a'))
      await cache.put('/b', new Response('b'))

      cache.clear()
      expect(cache.size).toBe(0)
      expect(await cache.get('/a')).toBeUndefined()
    })

    it('has checks existence', async () => {
      const cache = createMemoryCache()
      await cache.put('/exists', new Response('yes'))

      expect(cache.has('/exists')).toBe(true)
      expect(cache.has('/nope')).toBe(false)
    })

    it('size reflects current entry count', async () => {
      const cache = createMemoryCache()
      expect(cache.size).toBe(0)

      await cache.put('/a', new Response('a'))
      expect(cache.size).toBe(1)

      await cache.put('/b', new Response('b'))
      expect(cache.size).toBe(2)

      await cache.delete('/a')
      expect(cache.size).toBe(1)
    })

    it('default TTL applies to all entries', async () => {
      const cache = createMemoryCache({ defaultTtl: 0 }) // expire immediately

      await cache.put('/key', new Response('data'))
      await new Promise((r) => setTimeout(r, 10))
      const result = await cache.get('/key')
      expect(result).toBeUndefined()
    })

    it('multiple gets return independent clones', async () => {
      const cache = createMemoryCache()
      await cache.put('/key', new Response('data'))

      const r1 = await cache.get('/key')
      const r2 = await cache.get('/key')

      // Both should be valid and consumable independently
      expect(await r1!.text()).toBe('data')
      expect(await r2!.text()).toBe('data')
    })
  })
})
