import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { parseEnvSync } from '../../src/parse'
import { EnvValidationError } from '../../src/errors'
import { d1 } from '../../src/validators/d1'

describe('parseEnvSync with Valibot', () => {
  it('validates with Valibot string', () => {
    const schema = { API_KEY: v.pipe(v.string(), v.minLength(1)) }
    const env = parseEnvSync({ API_KEY: 'sk-123' }, schema)
    expect(env.API_KEY).toBe('sk-123')
  })

  it('rejects invalid values', () => {
    const schema = { API_KEY: v.pipe(v.string(), v.minLength(1)) }
    expect(() => parseEnvSync({ API_KEY: '' }, schema)).toThrow(EnvValidationError)
  })

  it('validates numbers', () => {
    const schema = { PORT: v.number() }
    const env = parseEnvSync({ PORT: 3000 }, schema)
    expect(env.PORT).toBe(3000)
  })

  it('validates booleans', () => {
    const schema = { DEBUG: v.boolean() }
    const env = parseEnvSync({ DEBUG: true }, schema)
    expect(env.DEBUG).toBe(true)
  })

  it('handles optional with defaults', () => {
    const schema = { PORT: v.optional(v.number(), 3000) }
    const env = parseEnvSync({}, schema)
    expect(env.PORT).toBe(3000)
  })

  it('mixes Valibot with workkit binding validators', () => {
    const mockD1 = { prepare: () => {}, batch: async () => [], exec: async () => ({}) }
    const schema = {
      API_KEY: v.pipe(v.string(), v.minLength(1)),
      DB: d1(),
    }
    const env = parseEnvSync({ API_KEY: 'test', DB: mockD1 }, schema)
    expect(env.API_KEY).toBe('test')
    expect(env.DB).toBe(mockD1)
  })

  it('validates enum values', () => {
    const schema = { ENV: v.picklist(['production', 'staging', 'development']) }
    const env = parseEnvSync({ ENV: 'production' }, schema)
    expect(env.ENV).toBe('production')
  })
})
