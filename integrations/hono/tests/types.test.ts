import { describe, it, expectTypeOf } from 'vitest'
import { Hono } from 'hono'
import { workkit } from '../src/middleware'
import { getEnv } from '../src/helpers'
import { workkitErrorHandler } from '../src/error-handler'
import { rateLimit, fixedWindow, parseDuration } from '../src/rate-limit'
import { cacheResponse } from '../src/cache'
import type {
  WorkkitOptions,
  ErrorHandlerOptions,
  RateLimiter,
  RateLimitResult,
  RateLimitOptions,
  FixedWindowOptions,
  CacheOptions,
  WorkkitEnv,
} from '../src/types'
import type { EnvSchema, InferEnv } from '@workkit/env'
import type { MiddlewareHandler, ErrorHandler, Context } from 'hono'

describe('type safety', () => {
  describe('workkit() types', () => {
    it('returns a MiddlewareHandler', () => {
      const schema = {} as EnvSchema
      const mw = workkit({ env: schema })
      expectTypeOf(mw).toMatchTypeOf<MiddlewareHandler>()
    })

    it('WorkkitOptions requires env schema', () => {
      expectTypeOf<WorkkitOptions<EnvSchema>>().toHaveProperty('env')
    })
  })

  describe('workkitErrorHandler types', () => {
    it('returns an ErrorHandler', () => {
      const handler = workkitErrorHandler()
      expectTypeOf(handler).toMatchTypeOf<ErrorHandler>()
    })

    it('accepts ErrorHandlerOptions', () => {
      expectTypeOf<ErrorHandlerOptions>().toHaveProperty('includeStack')
      expectTypeOf<ErrorHandlerOptions>().toHaveProperty('onError')
    })
  })

  describe('rateLimit types', () => {
    it('returns a MiddlewareHandler', () => {
      const mw = rateLimit({
        limiter: { check: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) },
        keyFn: () => 'key',
      })
      expectTypeOf(mw).toMatchTypeOf<MiddlewareHandler>()
    })

    it('RateLimiter has check method', () => {
      expectTypeOf<RateLimiter>().toHaveProperty('check')
    })

    it('RateLimitResult has required fields', () => {
      expectTypeOf<RateLimitResult>().toHaveProperty('allowed')
      expectTypeOf<RateLimitResult>().toHaveProperty('remaining')
      expectTypeOf<RateLimitResult>().toHaveProperty('resetAt')
    })

    it('FixedWindowOptions requires namespace, limit, window', () => {
      expectTypeOf<FixedWindowOptions>().toHaveProperty('namespace')
      expectTypeOf<FixedWindowOptions>().toHaveProperty('limit')
      expectTypeOf<FixedWindowOptions>().toHaveProperty('window')
    })
  })

  describe('cacheResponse types', () => {
    it('returns a MiddlewareHandler', () => {
      const mw = cacheResponse({ ttl: 300 })
      expectTypeOf(mw).toMatchTypeOf<MiddlewareHandler>()
    })

    it('CacheOptions requires ttl', () => {
      expectTypeOf<CacheOptions>().toHaveProperty('ttl')
    })

    it('CacheOptions has optional fields', () => {
      expectTypeOf<CacheOptions>().toHaveProperty('keyFn')
      expectTypeOf<CacheOptions>().toHaveProperty('cache')
      expectTypeOf<CacheOptions>().toHaveProperty('methods')
    })
  })

  describe('parseDuration types', () => {
    it('returns number', () => {
      expectTypeOf(parseDuration).returns.toBeNumber()
    })

    it('accepts string', () => {
      expectTypeOf(parseDuration).parameter(0).toBeString()
    })
  })

  describe('WorkkitEnv type', () => {
    it('has Variables with workkit:env', () => {
      expectTypeOf<WorkkitEnv>().toHaveProperty('Variables')
    })
  })

  describe('getEnv types', () => {
    it('is a function', () => {
      expectTypeOf(getEnv).toBeFunction()
    })
  })

  describe('export completeness', () => {
    it('all middleware exports are functions', () => {
      expectTypeOf(workkit).toBeFunction()
      expectTypeOf(workkitErrorHandler).toBeFunction()
      expectTypeOf(rateLimit).toBeFunction()
      expectTypeOf(cacheResponse).toBeFunction()
      expectTypeOf(getEnv).toBeFunction()
      expectTypeOf(fixedWindow).toBeFunction()
      expectTypeOf(parseDuration).toBeFunction()
    })
  })
})
