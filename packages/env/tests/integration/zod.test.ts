import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parseEnvSync, parseEnv } from '../../src/parse'
import { EnvValidationError } from '../../src/errors'
import { d1 } from '../../src/validators/d1'
import { kv } from '../../src/validators/kv'

describe('parseEnvSync with Zod', () => {
  it('validates string env vars with z.string()', () => {
    const schema = { API_KEY: z.string().min(1) }
    const env = parseEnvSync({ API_KEY: 'sk-123' }, schema)
    expect(env.API_KEY).toBe('sk-123')
  })

  it('rejects invalid string values', () => {
    const schema = { API_KEY: z.string().min(1) }
    expect(() => parseEnvSync({ API_KEY: '' }, schema)).toThrow(EnvValidationError)
  })

  it('validates number env vars', () => {
    const schema = { PORT: z.number() }
    const env = parseEnvSync({ PORT: 3000 }, schema)
    expect(env.PORT).toBe(3000)
  })

  it('validates boolean env vars', () => {
    const schema = { DEBUG: z.boolean() }
    const env = parseEnvSync({ DEBUG: true }, schema)
    expect(env.DEBUG).toBe(true)
  })

  it('handles optional values with Zod defaults', () => {
    const schema = { PORT: z.number().default(3000) }
    const env = parseEnvSync({}, schema)
    expect(env.PORT).toBe(3000)
  })

  it('mixes Zod validators with workkit binding validators', () => {
    const mockD1 = { prepare: () => {}, batch: async () => [], exec: async () => ({}) }
    const schema = {
      API_KEY: z.string().min(1),
      DB: d1(),
    }
    const env = parseEnvSync({ API_KEY: 'test', DB: mockD1 }, schema)
    expect(env.API_KEY).toBe('test')
    expect(env.DB).toBe(mockD1)
  })

  it('collects issues from both Zod and binding validators', () => {
    const schema = {
      API_KEY: z.string().min(1),
      DB: d1(),
    }
    try {
      parseEnvSync({}, schema)
      expect.unreachable('Should have thrown')
    } catch (err) {
      const envErr = err as EnvValidationError
      expect(envErr.issues.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('validates enum values', () => {
    const schema = { ENV: z.enum(['production', 'staging', 'development']) }
    const env = parseEnvSync({ ENV: 'production' }, schema)
    expect(env.ENV).toBe('production')
  })

  it('handles complex mixed schema', () => {
    const mockKV = { get: () => {}, put: () => {}, delete: () => {}, list: () => {}, getWithMetadata: () => {} }
    const mockD1Obj = { prepare: () => {}, batch: async () => [], exec: async () => ({}) }
    const schema = {
      API_KEY: z.string(),
      DB: d1(),
      CACHE: kv(),
      RATE_LIMIT: z.number().default(100),
    }
    const env = parseEnvSync(
      { API_KEY: 'sk-123', DB: mockD1Obj, CACHE: mockKV },
      schema,
    )
    expect(env.API_KEY).toBe('sk-123')
    expect(env.DB).toBe(mockD1Obj)
    expect(env.CACHE).toBe(mockKV)
    expect(env.RATE_LIMIT).toBe(100)
  })
})

describe('parseEnv (async) with Zod', () => {
  it('works with async parse', async () => {
    const schema = { API_KEY: z.string().min(1) }
    const env = await parseEnv({ API_KEY: 'test' }, schema)
    expect(env.API_KEY).toBe('test')
  })
})
