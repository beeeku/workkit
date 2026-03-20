import { describe, it, expect } from 'vitest'
import { r2 } from '../../src/validators/r2'

function mockR2() {
  return { get: () => {}, put: () => {}, delete: () => {}, list: () => {}, head: () => {} }
}

describe('r2()', () => {
  it('returns a valid StandardSchemaV1 object', () => {
    const v = r2()
    expect(v['~standard'].version).toBe(1)
    expect(v['~standard'].vendor).toBe('workkit')
  })

  it('accepts a real R2Bucket-shaped object', () => {
    const mock = mockR2()
    const result = r2()['~standard'].validate(mock)
    expect('value' in result).toBe(true)
  })

  it('rejects undefined', () => {
    expect('issues' in r2()['~standard'].validate(undefined)).toBe(true)
  })

  it('rejects null', () => {
    expect('issues' in r2()['~standard'].validate(null)).toBe(true)
  })

  it('rejects objects missing R2 methods', () => {
    expect('issues' in r2()['~standard'].validate({ get: () => {} })).toBe(true)
  })

  it('returns error with wrangler.toml hint', () => {
    const result = r2()['~standard'].validate(undefined)
    const issues = (result as { issues: Array<{ message: string }> }).issues
    expect(issues[0].message).toContain('R2Bucket')
    expect(issues[0].message).toContain('[[r2_buckets]]')
  })

  it('uses custom message', () => {
    const result = r2({ message: 'Custom' })['~standard'].validate(undefined)
    expect((result as any).issues[0].message).toBe('Custom')
  })
})
