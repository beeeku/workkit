import { describe, it, expect } from 'vitest'
import { EnvValidationError } from '../src/errors'
import type { EnvIssue } from '../src/errors'

describe('EnvValidationError', () => {
  it('formats missing bindings with wrangler.toml hints', () => {
    const issues: EnvIssue[] = [
      { key: 'DB', message: 'Expected a D1Database binding.', received: undefined },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('Missing:')
    expect(err.message).toContain('DB')
    expect(err.message).toContain('Expected a D1Database binding.')
  })

  it('formats invalid values with received value preview', () => {
    const issues: EnvIssue[] = [
      { key: 'RATE_LIMIT', message: 'Expected number', received: 'not-a-number' },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('Invalid:')
    expect(err.message).toContain('RATE_LIMIT')
    expect(err.message).toContain('received: "not-a-number"')
  })

  it('truncates long string values in error output', () => {
    const longValue = 'a'.repeat(100)
    const issues: EnvIssue[] = [
      { key: 'API_KEY', message: 'Invalid format', received: longValue },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('...')
    expect(err.message).not.toContain(longValue)
  })

  it('groups missing and invalid issues separately', () => {
    const issues: EnvIssue[] = [
      { key: 'API_KEY', message: 'Required', received: undefined },
      { key: 'PORT', message: 'Expected number', received: 'abc' },
    ]
    const err = new EnvValidationError(issues)
    const missingIdx = err.message.indexOf('Missing:')
    const invalidIdx = err.message.indexOf('Invalid:')
    expect(missingIdx).toBeLessThan(invalidIdx)
    expect(err.message).toContain('API_KEY')
    expect(err.message).toContain('PORT')
  })

  it('includes total issue count', () => {
    const issues: EnvIssue[] = [
      { key: 'A', message: 'bad', received: undefined },
      { key: 'B', message: 'bad', received: undefined },
      { key: 'C', message: 'bad', received: 'x' },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('3 issues found')
  })

  it('uses singular "issue" for single issue', () => {
    const issues: EnvIssue[] = [
      { key: 'A', message: 'bad', received: undefined },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('1 issue found')
  })

  it('provides programmatic access via .issues property', () => {
    const issues: EnvIssue[] = [
      { key: 'DB', message: 'Missing binding', received: undefined },
    ]
    const err = new EnvValidationError(issues)
    expect(err.issues).toHaveLength(1)
    expect(err.issues[0].key).toBe('DB')
    expect(err.issues[0].message).toBe('Missing binding')
  })

  it('extends WorkkitError', () => {
    const err = new EnvValidationError([{ key: 'A', message: 'bad', received: undefined }])
    expect(err.name).toBe('EnvValidationError')
    expect(err.code).toBe('WORKKIT_VALIDATION')
    expect(err.statusCode).toBe(400)
    expect(err.retryable).toBe(false)
  })

  it('formats null received value', () => {
    const issues: EnvIssue[] = [
      { key: 'X', message: 'Expected string', received: null },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('received: null')
  })

  it('formats object received value', () => {
    const issues: EnvIssue[] = [
      { key: 'X', message: 'Expected string', received: { foo: 'bar' } },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('received: [object Object]')
  })

  it('mentions wrangler.toml and .dev.vars in hint', () => {
    const issues: EnvIssue[] = [
      { key: 'A', message: 'bad', received: undefined },
    ]
    const err = new EnvValidationError(issues)
    expect(err.message).toContain('wrangler.toml')
    expect(err.message).toContain('.dev.vars')
  })
})
