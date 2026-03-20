import { WorkkitError } from './base'
import type { WorkkitErrorCode } from './types'
import { NotFoundError } from './categories/data'
import { UnauthorizedError, ForbiddenError } from './categories/auth'
import { RateLimitError, TimeoutError, ServiceUnavailableError } from './categories/network'
import { InternalError } from './categories/internal'
import type { RetryStrategy } from './types'

/**
 * Convert a WorkkitError to a Response suitable for returning from a Worker.
 * Strips internal details (cause, stack) from the response body.
 */
export function errorToResponse(error: WorkkitError): Response {
  const body: Record<string, unknown> = {
    error: {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    },
  }

  // Include validation issues if present
  if ('issues' in error && Array.isArray((error as any).issues)) {
    ;(body.error as any).issues = (error as any).issues
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Set Retry-After header for rate limit errors
  if (error instanceof RateLimitError && error.retryAfterMs) {
    headers['Retry-After'] = String(Math.ceil(error.retryAfterMs / 1000))
  }

  return new Response(JSON.stringify(body), {
    status: error.statusCode,
    headers,
  })
}

// Anonymous concrete class for fromHttpStatus 400 mapping
class HttpValidationError extends WorkkitError {
  readonly code = 'WORKKIT_VALIDATION' as const
  readonly statusCode = 400
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }
}

/**
 * Create a WorkkitError from an HTTP status code.
 * Useful for wrapping upstream API responses.
 */
export function fromHttpStatus(
  status: number,
  message?: string,
  options?: { cause?: unknown; context?: Record<string, unknown> },
): WorkkitError {
  switch (status) {
    case 400:
      return new HttpValidationError(message ?? 'Bad request', options)
    case 401:
      return new UnauthorizedError(message, options)
    case 403:
      return new ForbiddenError(message, options)
    case 404:
      return new NotFoundError(message ?? 'Resource', undefined, options)
    case 429:
      return new RateLimitError(message, undefined, options)
    case 504:
      return new TimeoutError(message ?? 'Upstream request', undefined, options)
    case 503:
      return new ServiceUnavailableError(message ?? 'Upstream service', options)
    default:
      if (status >= 500) {
        return new InternalError(message ?? `HTTP ${status}`, options)
      }
      return new InternalError(message ?? `Unexpected HTTP ${status}`, options)
  }
}

/**
 * Type guard: is this a WorkkitError?
 */
export function isWorkkitError(error: unknown): error is WorkkitError {
  return error instanceof WorkkitError
}

/**
 * Type guard: is this a specific WorkkitError code?
 */
export function isErrorCode<C extends WorkkitErrorCode>(
  error: unknown,
  code: C,
): boolean {
  return error instanceof WorkkitError && error.code === code
}
