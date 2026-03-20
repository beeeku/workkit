import { describe, it, expect } from 'vitest'
import { defineEnv } from '../src/env'
import {
  createMockContext,
  createMockContextWithoutRuntime,
  stringValidator,
  numberValidator,
  createMockKV,
  createMockD1,
  objectValidator,
} from './helpers'

describe('defineEnv', () => {
  describe('schema creation', () => {
    it('returns a callable accessor with schema property', () => {
      const schema = { API_KEY: stringValidator() }
      const env = defineEnv(schema)

      expect(typeof env).toBe('function')
      expect(env.schema).toBe(schema)
    })

    it('exposes the original schema for middleware use', () => {
      const schema = {
        API_KEY: stringValidator(),
        PORT: numberValidator(),
      }
      const env = defineEnv(schema)

      expect(env.schema).toStrictEqual(schema)
      expect(env.schema.API_KEY).toBe(schema.API_KEY)
      expect(env.schema.PORT).toBe(schema.PORT)
    })

    it('works with empty schema', () => {
      const env = defineEnv({})
      const context = createMockContext({ env: {} })
      const result = env(context)
      expect(result).toStrictEqual({})
    })
  })

  describe('context extraction', () => {
    it('extracts and validates env from Astro context', () => {
      const env = defineEnv({ API_KEY: stringValidator() })
      const context = createMockContext({ env: { API_KEY: 'my-secret-key' } })

      const result = env(context)
      expect(result.API_KEY).toBe('my-secret-key')
    })

    it('extracts multiple env vars', () => {
      const env = defineEnv({
        API_KEY: stringValidator(),
        PORT: numberValidator(),
      })
      const context = createMockContext({
        env: { API_KEY: 'key', PORT: '8080' },
      })

      const result = env(context)
      expect(result.API_KEY).toBe('key')
      expect(result.PORT).toBe(8080)
    })

    it('works with binding-type validators', () => {
      const kvValidator = objectValidator(['get', 'put', 'delete', 'list', 'getWithMetadata'], 'KVNamespace')
      const env = defineEnv({ CACHE: kvValidator })
      const mockKV = createMockKV()
      const context = createMockContext({ env: { CACHE: mockKV } })

      const result = env(context)
      expect(result.CACHE).toBe(mockKV)
    })

    it('works with D1-like bindings', () => {
      const d1Validator = objectValidator(['prepare', 'batch', 'exec'], 'D1Database')
      const env = defineEnv({ DB: d1Validator })
      const mockD1 = createMockD1()
      const context = createMockContext({ env: { DB: mockD1 } })

      const result = env(context)
      expect(result.DB).toBe(mockD1)
    })

    it('handles mixed string env vars and bindings', () => {
      const d1Validator = objectValidator(['prepare', 'batch', 'exec'], 'D1Database')
      const env = defineEnv({
        DB: d1Validator,
        API_KEY: stringValidator(),
        MAX_ITEMS: numberValidator(),
      })
      const mockD1 = createMockD1()
      const context = createMockContext({
        env: { DB: mockD1, API_KEY: 'secret', MAX_ITEMS: '100' },
      })

      const result = env(context)
      expect(result.DB).toBe(mockD1)
      expect(result.API_KEY).toBe('secret')
      expect(result.MAX_ITEMS).toBe(100)
    })
  })

  describe('validation', () => {
    it('throws EnvValidationError when env var is missing', () => {
      const env = defineEnv({ API_KEY: stringValidator() })
      const context = createMockContext({ env: {} })

      expect(() => env(context)).toThrow('Environment validation failed')
    })

    it('throws when env var fails validation', () => {
      const env = defineEnv({ API_KEY: stringValidator({ minLength: 10 }) })
      const context = createMockContext({ env: { API_KEY: 'short' } })

      expect(() => env(context)).toThrow('at least 10 characters')
    })

    it('collects all validation issues before throwing', () => {
      const env = defineEnv({
        API_KEY: stringValidator(),
        SECRET: stringValidator(),
        PORT: numberValidator(),
      })
      const context = createMockContext({ env: {} })

      try {
        env(context)
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.message).toContain('API_KEY')
        expect(error.message).toContain('SECRET')
        expect(error.message).toContain('PORT')
      }
    })

    it('throws when binding type is wrong', () => {
      const kvValidator = objectValidator(['get', 'put', 'delete', 'list', 'getWithMetadata'], 'KVNamespace')
      const env = defineEnv({ CACHE: kvValidator })
      const context = createMockContext({ env: { CACHE: 'not-a-kv' } })

      expect(() => env(context)).toThrow()
    })
  })

  describe('error handling', () => {
    it('throws ConfigError when runtime is not available', () => {
      const env = defineEnv({ API_KEY: stringValidator() })
      const context = createMockContextWithoutRuntime()

      expect(() => env(context)).toThrow('Cloudflare runtime not found')
    })

    it('error message mentions @astrojs/cloudflare adapter', () => {
      const env = defineEnv({ API_KEY: stringValidator() })
      const context = createMockContextWithoutRuntime()

      expect(() => env(context)).toThrow('@astrojs/cloudflare')
    })
  })

  describe('caching', () => {
    it('caches parsed env per context (same context returns same result)', () => {
      let parseCount = 0
      const trackingValidator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(value: unknown) {
            parseCount++
            return { value: value as string }
          },
        },
      }

      const env = defineEnv({ KEY: trackingValidator })
      const context = createMockContext({ env: { KEY: 'val' } })

      const result1 = env(context)
      const result2 = env(context)

      expect(result1).toBe(result2) // same reference
      expect(parseCount).toBe(1) // parsed only once
    })

    it('does not share cache between different contexts', () => {
      let parseCount = 0
      const trackingValidator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(value: unknown) {
            parseCount++
            return { value: value as string }
          },
        },
      }

      const env = defineEnv({ KEY: trackingValidator })
      const context1 = createMockContext({ env: { KEY: 'val1' } })
      const context2 = createMockContext({ env: { KEY: 'val2' } })

      env(context1)
      env(context2)

      expect(parseCount).toBe(2)
    })
  })
})
