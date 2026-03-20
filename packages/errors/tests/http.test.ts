import { describe, it, expect } from 'vitest'
import {
  errorToResponse,
  fromHttpStatus,
  isWorkkitError,
  isErrorCode,
} from '../src/http'
import { WorkkitError } from '../src/base'
import { NotFoundError, ValidationError } from '../src/categories/data'
import { RateLimitError } from '../src/categories/network'
import { UnauthorizedError, ForbiddenError } from '../src/categories/auth'
import { InternalError } from '../src/categories/internal'
import type { RetryStrategy } from '../src/types'

describe('errorToResponse', () => {
  it('returns correct status code', async () => {
    const error = new NotFoundError('User', '123')
    const res = errorToResponse(error)
    expect(res.status).toBe(404)
  })

  it('body contains code + message', async () => {
    const error = new NotFoundError('User', '123')
    const res = errorToResponse(error)
    const body = await res.json() as any
    expect(body.error.code).toBe('WORKKIT_NOT_FOUND')
    expect(body.error.message).toBe('User "123" not found')
    expect(body.error.statusCode).toBe(404)
  })

  it('includes validation issues', async () => {
    const error = new ValidationError('Invalid', [
      { path: ['name'], message: 'Required' },
    ])
    const res = errorToResponse(error)
    const body = await res.json() as any
    expect(body.error.issues).toEqual([{ path: ['name'], message: 'Required' }])
  })

  it('sets Retry-After header for RateLimitError', () => {
    const error = new RateLimitError('Too fast', 5000)
    const res = errorToResponse(error)
    expect(res.headers.get('Retry-After')).toBe('5')
  })

  it('Content-Type is application/json', () => {
    const error = new NotFoundError('Key')
    const res = errorToResponse(error)
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('does not set Retry-After for RateLimitError without retryAfterMs', () => {
    const error = new RateLimitError()
    const res = errorToResponse(error)
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('fromHttpStatus', () => {
  it('maps 400 to validation-like error', () => {
    const error = fromHttpStatus(400, 'Bad request')
    expect(error.code).toBe('WORKKIT_VALIDATION')
    expect(error.statusCode).toBe(400)
    expect(error.retryable).toBe(false)
  })

  it('maps 401 to UnauthorizedError', () => {
    const error = fromHttpStatus(401)
    expect(error).toBeInstanceOf(UnauthorizedError)
    expect(error.code).toBe('WORKKIT_UNAUTHORIZED')
  })

  it('maps 403 to ForbiddenError', () => {
    const error = fromHttpStatus(403)
    expect(error).toBeInstanceOf(ForbiddenError)
    expect(error.code).toBe('WORKKIT_FORBIDDEN')
  })

  it('maps 404 to NotFoundError', () => {
    const error = fromHttpStatus(404, 'User not found')
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.code).toBe('WORKKIT_NOT_FOUND')
  })

  it('maps 429 to RateLimitError', () => {
    const error = fromHttpStatus(429)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.code).toBe('WORKKIT_RATE_LIMIT')
  })

  it('maps 503 to ServiceUnavailableError', () => {
    const error = fromHttpStatus(503)
    expect(error.code).toBe('WORKKIT_SERVICE_UNAVAILABLE')
  })

  it('maps 504 to TimeoutError', () => {
    const error = fromHttpStatus(504)
    expect(error.code).toBe('WORKKIT_TIMEOUT')
  })

  it('maps other 5xx to InternalError', () => {
    const error = fromHttpStatus(502, 'Bad gateway')
    expect(error).toBeInstanceOf(InternalError)
    expect(error.code).toBe('WORKKIT_INTERNAL')
    expect(error.message).toBe('Bad gateway')
  })

  it('maps non-5xx unknown status to InternalError', () => {
    const error = fromHttpStatus(418, 'I am a teapot')
    expect(error).toBeInstanceOf(InternalError)
    expect(error.message).toBe('I am a teapot')
  })

  it('preserves cause in options', () => {
    const cause = new Error('upstream')
    const error = fromHttpStatus(500, 'fail', { cause })
    expect(error.cause).toBe(cause)
  })
})

describe('isWorkkitError', () => {
  it('returns true for WorkkitError instances', () => {
    expect(isWorkkitError(new NotFoundError('test'))).toBe(true)
    expect(isWorkkitError(new InternalError('test'))).toBe(true)
  })

  it('returns false for native Errors', () => {
    expect(isWorkkitError(new Error('test'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isWorkkitError('string')).toBe(false)
    expect(isWorkkitError(null)).toBe(false)
  })
})

describe('isErrorCode', () => {
  it('matches specific codes', () => {
    const error = new NotFoundError('User', '123')
    expect(isErrorCode(error, 'WORKKIT_NOT_FOUND')).toBe(true)
    expect(isErrorCode(error, 'WORKKIT_TIMEOUT')).toBe(false)
  })

  it('returns false for non-WorkkitError', () => {
    expect(isErrorCode(new Error('test'), 'WORKKIT_NOT_FOUND')).toBe(false)
  })
})
