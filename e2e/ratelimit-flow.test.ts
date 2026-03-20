import { describe, it, expect } from 'vitest'
import { fixedWindow, slidingWindow, tokenBucket, rateLimitHeaders, rateLimitResponse } from '@workkit/ratelimit'
import { createMockKV } from './helpers/setup'

describe('Rate limiting E2E', () => {
  describe('fixed window rate limiter', () => {
    it('allows requests under limit', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 5,
        window: '1m',
      })

      const result = await limiter.check('user:123')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
      expect(result.limit).toBe(5)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('counts up to the limit', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 3,
        window: '1m',
      })

      const r1 = await limiter.check('user:1')
      expect(r1.allowed).toBe(true)
      expect(r1.remaining).toBe(2)

      const r2 = await limiter.check('user:1')
      expect(r2.allowed).toBe(true)
      expect(r2.remaining).toBe(1)

      const r3 = await limiter.check('user:1')
      expect(r3.allowed).toBe(true)
      expect(r3.remaining).toBe(0)
    })

    it('blocks requests over limit', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 2,
        window: '1m',
      })

      await limiter.check('user:1')
      await limiter.check('user:1')
      const r3 = await limiter.check('user:1')

      expect(r3.allowed).toBe(false)
      expect(r3.remaining).toBe(0)
    })

    it('tracks different keys independently', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 2,
        window: '1m',
      })

      await limiter.check('user:1')
      await limiter.check('user:1')

      // user:2 should still have full quota
      const r = await limiter.check('user:2')
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(1)
    })

    it('supports custom prefix', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 10,
        window: '1h',
        prefix: 'api:ratelimit:',
      })

      const r = await limiter.check('endpoint:/users')
      expect(r.allowed).toBe(true)
    })

    it('uses 1 second window correctly', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 1,
        window: '1s',
      })

      const r1 = await limiter.check('key')
      expect(r1.allowed).toBe(true)

      const r2 = await limiter.check('key')
      expect(r2.allowed).toBe(false)
    })
  })

  describe('sliding window rate limiter', () => {
    it('allows requests under limit', async () => {
      const kv = createMockKV()
      const limiter = slidingWindow({
        namespace: kv,
        limit: 5,
        window: '1m',
      })

      const result = await limiter.check('user:1')
      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(5)
    })

    it('blocks requests over limit', async () => {
      const kv = createMockKV()
      const limiter = slidingWindow({
        namespace: kv,
        limit: 2,
        window: '1m',
      })

      await limiter.check('user:1')
      await limiter.check('user:1')
      const r3 = await limiter.check('user:1')
      expect(r3.allowed).toBe(false)
    })
  })

  describe('token bucket rate limiter', () => {
    it('allows consumption when tokens available', async () => {
      const kv = createMockKV()
      const limiter = tokenBucket({
        namespace: kv,
        capacity: 10,
        refillRate: 1,
        refillInterval: '1s',
      })

      const result = await limiter.consume('user:1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBeLessThanOrEqual(10)
    })

    it('allows consuming multiple tokens', async () => {
      const kv = createMockKV()
      const limiter = tokenBucket({
        namespace: kv,
        capacity: 10,
        refillRate: 1,
        refillInterval: '1s',
      })

      const r = await limiter.consume('user:1', 5)
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBeLessThanOrEqual(5)
    })

    it('blocks when tokens exhausted', async () => {
      const kv = createMockKV()
      const limiter = tokenBucket({
        namespace: kv,
        capacity: 3,
        refillRate: 1,
        refillInterval: '1h', // slow refill
      })

      await limiter.consume('user:1', 3) // exhaust all tokens
      const r = await limiter.consume('user:1', 1)
      expect(r.allowed).toBe(false)
      expect(r.remaining).toBe(0)
    })

    it('different keys have independent buckets', async () => {
      const kv = createMockKV()
      const limiter = tokenBucket({
        namespace: kv,
        capacity: 5,
        refillRate: 1,
        refillInterval: '1s',
      })

      await limiter.consume('user:1', 5) // exhaust user:1

      const r = await limiter.consume('user:2', 1) // user:2 unaffected
      expect(r.allowed).toBe(true)
    })
  })

  describe('rate limit headers', () => {
    it('generates correct headers for allowed request', () => {
      const result = {
        allowed: true,
        remaining: 4,
        resetAt: new Date(Date.now() + 60000),
        limit: 5,
      }

      const headers = rateLimitHeaders(result)
      expect(headers['X-RateLimit-Limit']).toBe('5')
      expect(headers['X-RateLimit-Remaining']).toBe('4')
      expect(headers['X-RateLimit-Reset']).toBeDefined()
      expect(headers['Retry-After']).toBeUndefined()
    })

    it('includes Retry-After for blocked request', () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 30000),
        limit: 5,
      }

      const headers = rateLimitHeaders(result)
      expect(headers['X-RateLimit-Remaining']).toBe('0')
      expect(headers['Retry-After']).toBeDefined()
      expect(parseInt(headers['Retry-After']!)).toBeGreaterThan(0)
    })

    it('rateLimitResponse returns 429 with headers', async () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
        limit: 10,
      }

      const res = rateLimitResponse(result)
      expect(res.status).toBe(429)
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(res.headers.get('Retry-After')).toBeDefined()
      expect(res.headers.get('Content-Type')).toBe('application/json')

      const body = await res.json() as any
      expect(body.error).toContain('Rate limit exceeded')
    })

    it('rateLimitResponse accepts custom message', async () => {
      const result = {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
        limit: 10,
      }

      const res = rateLimitResponse(result, 'Too many API calls')
      const body = await res.json() as any
      expect(body.error).toBe('Too many API calls')
    })
  })

  describe('rate limiter integration with KV', () => {
    it('state persists across check calls', async () => {
      const kv = createMockKV()
      const limiter = fixedWindow({
        namespace: kv,
        limit: 100,
        window: '1m',
      })

      // Make 50 requests
      for (let i = 0; i < 50; i++) {
        await limiter.check('user:burst')
      }

      const result = await limiter.check('user:burst')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(49) // 100 - 51
    })

    it('multiple limiters on the same KV namespace with different prefixes', async () => {
      const kv = createMockKV()
      const apiLimiter = fixedWindow({
        namespace: kv,
        limit: 100,
        window: '1m',
        prefix: 'api:',
      })
      const authLimiter = fixedWindow({
        namespace: kv,
        limit: 5,
        window: '1m',
        prefix: 'auth:',
      })

      // Exhaust auth limiter for a user
      for (let i = 0; i < 5; i++) {
        await authLimiter.check('user:1')
      }
      const authResult = await authLimiter.check('user:1')
      expect(authResult.allowed).toBe(false)

      // API limiter for same user is unaffected
      const apiResult = await apiLimiter.check('user:1')
      expect(apiResult.allowed).toBe(true)
    })
  })
})
