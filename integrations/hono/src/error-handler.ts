import type { ErrorHandler } from 'hono'
import {
  WorkkitError,
  isWorkkitError,
  RateLimitError,
  InternalError,
} from '@workkit/errors'
import type { ErrorHandlerOptions } from './types'

/**
 * Hono error handler that converts WorkkitErrors to proper HTTP responses.
 *
 * - WorkkitError instances → structured JSON with their status code
 * - RateLimitError → includes Retry-After header
 * - ValidationError → includes issues array
 * - Unknown errors → 500 Internal Server Error
 *
 * @example
 * ```ts
 * app.onError(workkitErrorHandler({
 *   includeStack: false,
 *   onError: (err, c) => console.error(err),
 * }))
 * ```
 */
export function workkitErrorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  const { includeStack = false, onError } = options

  return async (err, c) => {
    if (onError) {
      try {
        await onError(err, c)
      } catch {
        // Don't let error callback failures break the response
      }
    }

    if (isWorkkitError(err)) {
      return workkitErrorToResponse(err, includeStack)
    }

    // Wrap unknown errors as InternalError
    const wrapped = new InternalError(
      err instanceof Error ? err.message : 'An unexpected error occurred',
      { cause: err },
    )

    return workkitErrorToResponse(wrapped, includeStack)
  }
}

function workkitErrorToResponse(error: WorkkitError, includeStack: boolean): Response {
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

  if (includeStack && error.stack) {
    ;(body.error as any).stack = error.stack
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
