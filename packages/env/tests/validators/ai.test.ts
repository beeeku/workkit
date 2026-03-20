import { describe, it, expect } from 'vitest'
import { ai } from '../../src/validators/ai'

function mockAi() {
  return { run: () => {} }
}

describe('ai()', () => {
  it('returns a valid StandardSchemaV1 object', () => {
    const v = ai()
    expect(v['~standard'].version).toBe(1)
    expect(v['~standard'].vendor).toBe('workkit')
  })

  it('accepts an Ai-shaped object', () => {
    const mock = mockAi()
    const result = ai()['~standard'].validate(mock)
    expect('value' in result).toBe(true)
  })

  it('rejects undefined', () => {
    expect('issues' in ai()['~standard'].validate(undefined)).toBe(true)
  })

  it('rejects objects without run method', () => {
    expect('issues' in ai()['~standard'].validate({ foo: 'bar' })).toBe(true)
  })

  it('returns error with wrangler.toml hint', () => {
    const result = ai()['~standard'].validate(undefined)
    const issues = (result as any).issues
    expect(issues[0].message).toContain('Ai')
    expect(issues[0].message).toContain('[ai]')
  })

  it('uses custom message', () => {
    const result = ai({ message: 'Custom' })['~standard'].validate(undefined)
    expect((result as any).issues[0].message).toBe('Custom')
  })
})
