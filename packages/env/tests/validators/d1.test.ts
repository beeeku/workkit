import { describe, it, expect } from 'vitest'
import { d1 } from '../../src/validators/d1'

// Mock D1Database shape
function mockD1() {
  return {
    prepare: () => {},
    batch: async () => [],
    exec: async () => ({}),
    dump: async () => new ArrayBuffer(0),
  }
}

describe('d1()', () => {
  it('returns a valid StandardSchemaV1 object', () => {
    const validator = d1()
    expect(validator['~standard']).toBeDefined()
    expect(validator['~standard'].version).toBe(1)
    expect(validator['~standard'].vendor).toBe('workkit')
    expect(typeof validator['~standard'].validate).toBe('function')
  })

  it('accepts a real D1Database-shaped object', () => {
    const mock = mockD1()
    const result = d1()['~standard'].validate(mock)
    expect('value' in result).toBe(true)
    expect((result as { value: unknown }).value).toBe(mock)
  })

  it('returns the object as-is (no transformation)', () => {
    const mock = mockD1()
    const result = d1()['~standard'].validate(mock)
    expect((result as { value: unknown }).value).toBe(mock)
  })

  it('rejects undefined', () => {
    const result = d1()['~standard'].validate(undefined)
    expect('issues' in result).toBe(true)
  })

  it('rejects null', () => {
    const result = d1()['~standard'].validate(null)
    expect('issues' in result).toBe(true)
  })

  it('rejects a plain object without D1 methods', () => {
    const result = d1()['~standard'].validate({ foo: 'bar' })
    expect('issues' in result).toBe(true)
  })

  it('rejects a KVNamespace (different shape)', () => {
    const kvMock = { get: () => {}, put: () => {}, delete: () => {}, list: () => {}, getWithMetadata: () => {} }
    const result = d1()['~standard'].validate(kvMock)
    expect('issues' in result).toBe(true)
  })

  it('returns descriptive error with wrangler.toml hint', () => {
    const result = d1()['~standard'].validate(undefined)
    const issues = (result as { issues: Array<{ message: string }> }).issues
    expect(issues[0].message).toContain('D1Database')
    expect(issues[0].message).toContain('wrangler.toml')
    expect(issues[0].message).toContain('[[d1_databases]]')
  })

  it('uses custom message when provided', () => {
    const result = d1({ message: 'Custom D1 error' })['~standard'].validate(undefined)
    const issues = (result as { issues: Array<{ message: string }> }).issues
    expect(issues[0].message).toBe('Custom D1 error')
  })
})
