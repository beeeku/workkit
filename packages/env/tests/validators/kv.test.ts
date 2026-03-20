import { describe, it, expect } from 'vitest'
import { kv } from '../../src/validators/kv'

function mockKV() {
  return { get: () => {}, put: () => {}, delete: () => {}, list: () => {}, getWithMetadata: () => {} }
}

describe('kv()', () => {
  it('returns a valid StandardSchemaV1 object', () => {
    const v = kv()
    expect(v['~standard'].version).toBe(1)
    expect(v['~standard'].vendor).toBe('workkit')
    expect(typeof v['~standard'].validate).toBe('function')
  })

  it('accepts a real KVNamespace-shaped object', () => {
    const mock = mockKV()
    const result = kv()['~standard'].validate(mock)
    expect('value' in result).toBe(true)
    expect((result as { value: unknown }).value).toBe(mock)
  })

  it('rejects undefined', () => {
    const result = kv()['~standard'].validate(undefined)
    expect('issues' in result).toBe(true)
  })

  it('rejects null', () => {
    const result = kv()['~standard'].validate(null)
    expect('issues' in result).toBe(true)
  })

  it('rejects objects missing KV methods', () => {
    const result = kv()['~standard'].validate({ get: () => {} })
    expect('issues' in result).toBe(true)
  })

  it('returns error with wrangler.toml hint', () => {
    const result = kv()['~standard'].validate(undefined)
    const issues = (result as { issues: Array<{ message: string }> }).issues
    expect(issues[0].message).toContain('KVNamespace')
    expect(issues[0].message).toContain('[[kv_namespaces]]')
  })

  it('uses custom message when provided', () => {
    const result = kv({ message: 'Custom KV error' })['~standard'].validate(undefined)
    const issues = (result as { issues: Array<{ message: string }> }).issues
    expect(issues[0].message).toBe('Custom KV error')
  })
})
