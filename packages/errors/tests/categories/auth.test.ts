import { describe, it, expect } from 'vitest'
import { UnauthorizedError, ForbiddenError } from '../../src/categories/auth'
import { WorkkitError } from '../../src/base'

describe('UnauthorizedError', () => {
  it('has default message', () => {
    const error = new UnauthorizedError()
    expect(error.message).toBe('Authentication required')
  })

  it('accepts custom message', () => {
    const error = new UnauthorizedError('Token expired')
    expect(error.message).toBe('Token expired')
  })

  it('has correct code, statusCode, non-retryable', () => {
    const error = new UnauthorizedError()
    expect(error.code).toBe('WORKKIT_UNAUTHORIZED')
    expect(error.statusCode).toBe(401)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('extends WorkkitError', () => {
    expect(new UnauthorizedError()).toBeInstanceOf(WorkkitError)
  })
})

describe('ForbiddenError', () => {
  it('has default message', () => {
    const error = new ForbiddenError()
    expect(error.message).toBe('Insufficient permissions')
  })

  it('accepts custom message', () => {
    const error = new ForbiddenError('Admin access required')
    expect(error.message).toBe('Admin access required')
  })

  it('has correct code, statusCode, non-retryable', () => {
    const error = new ForbiddenError()
    expect(error.code).toBe('WORKKIT_FORBIDDEN')
    expect(error.statusCode).toBe(403)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('extends WorkkitError', () => {
    expect(new ForbiddenError()).toBeInstanceOf(WorkkitError)
  })
})
