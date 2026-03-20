import { describe, it, expect } from 'vitest'
import { InternalError, ConfigError } from '../../src/categories/internal'
import { WorkkitError } from '../../src/base'

describe('InternalError', () => {
  it('is non-retryable', () => {
    const error = new InternalError('unexpected failure')
    expect(error.code).toBe('WORKKIT_INTERNAL')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('extends WorkkitError', () => {
    expect(new InternalError('test')).toBeInstanceOf(WorkkitError)
  })

  it('preserves cause', () => {
    const cause = new Error('root')
    const error = new InternalError('wrapped', { cause })
    expect(error.cause).toBe(cause)
  })
})

describe('ConfigError', () => {
  it('is non-retryable', () => {
    const error = new ConfigError('missing API key')
    expect(error.code).toBe('WORKKIT_CONFIG')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('extends WorkkitError', () => {
    expect(new ConfigError('test')).toBeInstanceOf(WorkkitError)
  })
})
