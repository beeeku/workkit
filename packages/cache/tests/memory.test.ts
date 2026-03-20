import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryCache } from '../src/memory'

describe('createMemoryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic operations', () => {
    it('should put and get a response', async () => {
      const cache = createMemoryCache()
      const response = new Response('hello world')
      await cache.put('/test', response)

      const cached = await cache.get('/test')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('hello world')
    })

    it('should return undefined for cache miss', async () => {
      const cache = createMemoryCache()
      const result = await cache.get('/nonexistent')
      expect(result).toBeUndefined()
    })

    it('should delete an entry', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'))
      const deleted = await cache.delete('/test')
      expect(deleted).toBe(true)

      const cached = await cache.get('/test')
      expect(cached).toBeUndefined()
    })

    it('should return false when deleting nonexistent entry', async () => {
      const cache = createMemoryCache()
      const deleted = await cache.delete('/nonexistent')
      expect(deleted).toBe(false)
    })

    it('should preserve response headers', async () => {
      const cache = createMemoryCache()
      const response = new Response('data', {
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' },
      })
      await cache.put('/test', response)

      const cached = await cache.get('/test')
      expect(cached!.headers.get('Content-Type')).toBe('application/json')
      expect(cached!.headers.get('X-Custom')).toBe('value')
    })

    it('should preserve response status', async () => {
      const cache = createMemoryCache()
      const response = new Response('not found', { status: 404, statusText: 'Not Found' })
      await cache.put('/test', response)

      const cached = await cache.get('/test')
      expect(cached!.status).toBe(404)
    })

    it('should clone responses on put so original remains usable', async () => {
      const cache = createMemoryCache()
      const response = new Response('original')
      await cache.put('/test', response)

      // Original should still be consumable
      // (Response body can only be consumed once, but put should clone)
      const cached = await cache.get('/test')
      expect(await cached!.text()).toBe('original')
    })

    it('should clone responses on get so cache entry remains usable', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'))

      const first = await cache.get('/test')
      await first!.text() // consume body

      const second = await cache.get('/test')
      expect(await second!.text()).toBe('data')
    })

    it('should handle full URLs as keys', async () => {
      const cache = createMemoryCache()
      await cache.put('https://example.com/api/data', new Response('hello'))
      const cached = await cache.get('https://example.com/api/data')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('hello')
    })

    it('should handle keys without leading slash', async () => {
      const cache = createMemoryCache()
      await cache.put('test', new Response('hello'))
      const cached = await cache.get('test')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('hello')
    })
  })

  describe('TTL expiry', () => {
    it('should return entry within TTL', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'), { ttl: 60 })

      vi.advanceTimersByTime(30_000) // 30 seconds

      const cached = await cache.get('/test')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('data')
    })

    it('should expire entry after TTL', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'), { ttl: 60 })

      vi.advanceTimersByTime(61_000) // 61 seconds

      const cached = await cache.get('/test')
      expect(cached).toBeUndefined()
    })

    it('should expire exactly at TTL boundary', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'), { ttl: 60 })

      vi.advanceTimersByTime(60_000) // exactly 60 seconds

      const cached = await cache.get('/test')
      expect(cached).toBeDefined() // at exactly ttl, not expired yet
    })

    it('should use defaultTtl when no ttl option provided', async () => {
      const cache = createMemoryCache({ defaultTtl: 30 })
      await cache.put('/test', new Response('data'))

      vi.advanceTimersByTime(31_000)

      const cached = await cache.get('/test')
      expect(cached).toBeUndefined()
    })

    it('should override defaultTtl with per-put ttl', async () => {
      const cache = createMemoryCache({ defaultTtl: 30 })
      await cache.put('/test', new Response('data'), { ttl: 120 })

      vi.advanceTimersByTime(60_000)

      const cached = await cache.get('/test')
      expect(cached).toBeDefined()
    })

    it('should parse max-age from cacheControl', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'), { cacheControl: 'public, max-age=10' })

      vi.advanceTimersByTime(11_000)

      const cached = await cache.get('/test')
      expect(cached).toBeUndefined()
    })

    it('should never expire when no TTL is set', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('data'))

      vi.advanceTimersByTime(999_999_000) // ~11 days

      const cached = await cache.get('/test')
      expect(cached).toBeDefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxSize exceeded', async () => {
      const cache = createMemoryCache({ maxSize: 3 })

      await cache.put('/a', new Response('a'))
      vi.advanceTimersByTime(10)
      await cache.put('/b', new Response('b'))
      vi.advanceTimersByTime(10)
      await cache.put('/c', new Response('c'))
      vi.advanceTimersByTime(10)
      await cache.put('/d', new Response('d'))

      // /a should be evicted (oldest)
      expect(await cache.get('/a')).toBeUndefined()
      expect(await cache.get('/b')).toBeDefined()
      expect(await cache.get('/c')).toBeDefined()
      expect(await cache.get('/d')).toBeDefined()
    })

    it('should evict least-recently-accessed entry', async () => {
      const cache = createMemoryCache({ maxSize: 3 })

      await cache.put('/a', new Response('a'))
      vi.advanceTimersByTime(10)
      await cache.put('/b', new Response('b'))
      vi.advanceTimersByTime(10)
      await cache.put('/c', new Response('c'))
      vi.advanceTimersByTime(10)

      // Access /a to make it recently used
      await cache.get('/a')
      vi.advanceTimersByTime(10)

      // Insert /d — should evict /b (least recently accessed)
      await cache.put('/d', new Response('d'))

      expect(await cache.get('/a')).toBeDefined()
      expect(await cache.get('/b')).toBeUndefined()
      expect(await cache.get('/c')).toBeDefined()
      expect(await cache.get('/d')).toBeDefined()
    })

    it('should not exceed maxSize', async () => {
      const cache = createMemoryCache({ maxSize: 5 })

      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(10)
        await cache.put(`/item-${i}`, new Response(`data-${i}`))
      }

      expect(cache.size).toBeLessThanOrEqual(5)
    })

    it('should default maxSize to 1000', async () => {
      const cache = createMemoryCache()
      // We don't insert 1000+ items but ensure it doesn't evict small sets
      for (let i = 0; i < 50; i++) {
        await cache.put(`/item-${i}`, new Response(`data-${i}`))
      }
      expect(cache.size).toBe(50)
    })
  })

  describe('size and utility methods', () => {
    it('should report correct size', async () => {
      const cache = createMemoryCache()
      expect(cache.size).toBe(0)

      await cache.put('/a', new Response('a'))
      expect(cache.size).toBe(1)

      await cache.put('/b', new Response('b'))
      expect(cache.size).toBe(2)

      await cache.delete('/a')
      expect(cache.size).toBe(1)
    })

    it('should exclude expired entries from size', async () => {
      const cache = createMemoryCache()
      await cache.put('/a', new Response('a'), { ttl: 10 })
      await cache.put('/b', new Response('b'))

      vi.advanceTimersByTime(11_000)

      expect(cache.size).toBe(1) // only /b remains
    })

    it('should clear all entries', async () => {
      const cache = createMemoryCache()
      await cache.put('/a', new Response('a'))
      await cache.put('/b', new Response('b'))
      await cache.put('/c', new Response('c'))

      cache.clear()
      expect(cache.size).toBe(0)
      expect(await cache.get('/a')).toBeUndefined()
    })

    it('should check if key exists with has()', async () => {
      const cache = createMemoryCache()
      await cache.put('/exists', new Response('yes'))

      expect(cache.has('/exists')).toBe(true)
      expect(cache.has('/nope')).toBe(false)
    })

    it('should return false for expired keys in has()', async () => {
      const cache = createMemoryCache()
      await cache.put('/temp', new Response('data'), { ttl: 5 })

      vi.advanceTimersByTime(6_000)

      expect(cache.has('/temp')).toBe(false)
    })
  })

  describe('overwrite behavior', () => {
    it('should overwrite existing entry', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('first'))
      await cache.put('/test', new Response('second'))

      const cached = await cache.get('/test')
      expect(await cached!.text()).toBe('second')
      expect(cache.size).toBe(1)
    })

    it('should reset TTL on overwrite', async () => {
      const cache = createMemoryCache()
      await cache.put('/test', new Response('first'), { ttl: 10 })

      vi.advanceTimersByTime(8_000) // 8 seconds in

      await cache.put('/test', new Response('second'), { ttl: 10 })

      vi.advanceTimersByTime(8_000) // 16 seconds total, but 8 since last put

      const cached = await cache.get('/test')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('second')
    })
  })

  describe('custom baseUrl', () => {
    it('should use custom baseUrl for key normalization', async () => {
      const cache = createMemoryCache({ baseUrl: 'https://my-app.local' })
      await cache.put('/data', new Response('hello'))

      const cached = await cache.get('/data')
      expect(cached).toBeDefined()
      expect(await cached!.text()).toBe('hello')
    })
  })
})
