import { describe, it, expect } from 'vitest'
import { NotFoundError, ConflictError, ValidationError } from '../../src/categories/data'
import type { ValidationIssue } from '../../src/categories/data'
import { WorkkitError } from '../../src/base'

describe('NotFoundError', () => {
  it('formats message with resource + identifier', () => {
    const error = new NotFoundError('User', '123')
    expect(error.message).toBe('User "123" not found')
  })

  it('formats message with resource only (no identifier)', () => {
    const error = new NotFoundError('User')
    expect(error.message).toBe('User not found')
  })

  it('includes resource/identifier in context', () => {
    const error = new NotFoundError('User', '123')
    expect(error.context).toEqual(expect.objectContaining({ resource: 'User', identifier: '123' }))
  })

  it('has correct code, statusCode, retryable', () => {
    const error = new NotFoundError('Key')
    expect(error.code).toBe('WORKKIT_NOT_FOUND')
    expect(error.statusCode).toBe(404)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })
})

describe('ConflictError', () => {
  it('is retryable with exponential backoff', () => {
    const error = new ConflictError('Write conflict on row 5')
    expect(error.code).toBe('WORKKIT_CONFLICT')
    expect(error.statusCode).toBe(409)
    expect(error.retryable).toBe(true)
    expect(error.retryStrategy).toEqual({
      kind: 'exponential',
      baseMs: 100,
      maxMs: 5000,
      maxAttempts: 3,
    })
  })
})

describe('ValidationError', () => {
  it('stores issues array', () => {
    const issues: ValidationIssue[] = [
      { path: ['name'], message: 'Required' },
      { path: ['age'], message: 'Must be positive', code: 'too_small' },
    ]
    const error = new ValidationError('Validation failed', issues)
    expect(error.issues).toEqual(issues)
    expect(error.issues).toHaveLength(2)
  })

  it('defaults to empty issues array', () => {
    const error = new ValidationError('Invalid input')
    expect(error.issues).toEqual([])
  })

  it('has correct code, statusCode, retryable', () => {
    const error = new ValidationError('Bad input')
    expect(error.code).toBe('WORKKIT_VALIDATION')
    expect(error.statusCode).toBe(400)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('includes issues in context', () => {
    const issues: ValidationIssue[] = [{ path: ['email'], message: 'Invalid format' }]
    const error = new ValidationError('Validation failed', issues)
    expect(error.context).toEqual(expect.objectContaining({ issues }))
  })

  it('extends WorkkitError', () => {
    const error = new ValidationError('test')
    expect(error).toBeInstanceOf(WorkkitError)
  })
})
