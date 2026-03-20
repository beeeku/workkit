import { describe, it, expect } from 'vitest'
import { service } from '../../src/validators/service'

function mockFetcher() {
  return { fetch: () => {} }
}

describe('service()', () => {
  it('returns a valid StandardSchemaV1 object', () => {
    const v = service()
    expect(v['~standard'].version).toBe(1)
    expect(v['~standard'].vendor).toBe('workkit')
  })

  it('accepts a Fetcher-shaped object', () => {
    const mock = mockFetcher()
    const result = service()['~standard'].validate(mock)
    expect('value' in result).toBe(true)
  })

  it('rejects undefined', () => {
    expect('issues' in service()['~standard'].validate(undefined)).toBe(true)
  })

  it('rejects objects without fetch method', () => {
    expect('issues' in service()['~standard'].validate({ send: () => {} })).toBe(true)
  })

  it('returns error with wrangler.toml hint', () => {
    const result = service()['~standard'].validate(undefined)
    const issues = (result as any).issues
    expect(issues[0].message).toContain('Service')
    expect(issues[0].message).toContain('[[services]]')
  })

  it('uses custom message', () => {
    const result = service({ message: 'Custom' })['~standard'].validate(undefined)
    expect((result as any).issues[0].message).toBe('Custom')
  })
})
