import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { swr } from '../src/swr'
import { createMemoryCache } from '../src/memory'

describe('swr (stale-while-revalidate)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cache miss', () => {
    it('should fetch and return fresh data on cache miss', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn().mockResolvedValue({ users: [1, 2, 3] })

      const result = await swr({
        key: '/api/users',
        ttl: 300,
        staleWhileRevalidate: 3600,
        fetch: fetchFn,
        cache,
      })

      expect(result.data).toEqual({ users: [1, 2, 3] })
      expect(result.stale).toBe(false)
      expect(result.age).toBe(0)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('should cache the fetched data', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn().mockResolvedValue({ value: 'cached' })

      await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })

      // Second call should hit cache
      const result = await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })

      expect(result.data).toEqual({ value: 'cached' })
      expect(result.stale).toBe(false)
      expect(fetchFn).toHaveBeenCalledTimes(1) // not called again
    })
  })

  describe('fresh response', () => {
    it('should return fresh data within TTL', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn().mockResolvedValue({ fresh: true })

      await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })

      vi.advanceTimersByTime(100_000) // 100 seconds, within 300s TTL

      const result = await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })

      expect(result.data).toEqual({ fresh: true })
      expect(result.stale).toBe(false)
      expect(result.age).toBe(100)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('should report correct age', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn().mockResolvedValue('data')

      await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })

      vi.advanceTimersByTime(42_000)

      const result = await swr({ key: '/test', ttl: 300, staleWhileRevalidate: 3600, fetch: fetchFn, cache })
      expect(result.age).toBe(42)
    })
  })

  describe('stale response', () => {
    it('should return stale data after TTL but within staleWhileRevalidate', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockResolvedValueOnce({ version: 2 })

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      vi.advanceTimersByTime(120_000) // 120 seconds — past TTL but within stale window

      const result = await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      expect(result.data).toEqual({ version: 1 }) // stale data
      expect(result.stale).toBe(true)
      expect(result.age).toBe(120)
    })

    it('should trigger background revalidation for stale data', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockResolvedValueOnce({ version: 2 })

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      vi.advanceTimersByTime(90_000) // past TTL

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      // Allow microtasks to flush (revalidation is fire-and-forget)
      await vi.advanceTimersByTimeAsync(1)

      expect(fetchFn).toHaveBeenCalledTimes(2) // original + revalidation
    })

    it('should serve fresh data after revalidation completes', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockResolvedValueOnce({ version: 2 })

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      vi.advanceTimersByTime(90_000) // past TTL

      // This returns stale and triggers revalidation
      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })
      await vi.advanceTimersByTimeAsync(1) // flush revalidation

      // Now data should be fresh again
      const result = await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })
      expect(result.data).toEqual({ version: 2 })
      expect(result.stale).toBe(false)
    })
  })

  describe('expired response', () => {
    it('should fetch fresh when beyond stale window', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockResolvedValueOnce({ version: 2 })

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 120, fetch: fetchFn, cache })

      vi.advanceTimersByTime(300_000) // 300 seconds — beyond ttl + staleWhileRevalidate

      const result = await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 120, fetch: fetchFn, cache })

      expect(result.data).toEqual({ version: 2 })
      expect(result.stale).toBe(false)
      expect(result.age).toBe(0)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('should propagate fetch error on cache miss', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(
        swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })
      ).rejects.toThrow('Network error')
    })

    it('should swallow revalidation errors and keep serving stale', async () => {
      const cache = createMemoryCache()
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ version: 1 })
        .mockRejectedValueOnce(new Error('Revalidation failed'))

      await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })

      vi.advanceTimersByTime(90_000)

      // Should return stale data even though revalidation will fail
      const result = await swr({ key: '/test', ttl: 60, staleWhileRevalidate: 300, fetch: fetchFn, cache })
      expect(result.data).toEqual({ version: 1 })
      expect(result.stale).toBe(true)

      // Flush revalidation (should not throw)
      await vi.advanceTimersByTimeAsync(1)
    })
  })

  describe('different data types', () => {
    it('should handle string data', async () => {
      const cache = createMemoryCache()
      const result = await swr({
        key: '/test',
        ttl: 60,
        staleWhileRevalidate: 300,
        fetch: async () => 'hello',
        cache,
      })
      expect(result.data).toBe('hello')
    })

    it('should handle number data', async () => {
      const cache = createMemoryCache()
      const result = await swr({
        key: '/test',
        ttl: 60,
        staleWhileRevalidate: 300,
        fetch: async () => 42,
        cache,
      })
      expect(result.data).toBe(42)
    })

    it('should handle array data', async () => {
      const cache = createMemoryCache()
      const result = await swr({
        key: '/test',
        ttl: 60,
        staleWhileRevalidate: 300,
        fetch: async () => [1, 2, 3],
        cache,
      })
      expect(result.data).toEqual([1, 2, 3])
    })

    it('should handle null data', async () => {
      const cache = createMemoryCache()
      const result = await swr({
        key: '/test',
        ttl: 60,
        staleWhileRevalidate: 300,
        fetch: async () => null,
        cache,
      })
      expect(result.data).toBeNull()
    })

    it('should handle nested objects', async () => {
      const cache = createMemoryCache()
      const data = { user: { name: 'test', roles: ['admin'] } }
      const result = await swr({
        key: '/test',
        ttl: 60,
        staleWhileRevalidate: 300,
        fetch: async () => data,
        cache,
      })
      expect(result.data).toEqual(data)
    })
  })
})
