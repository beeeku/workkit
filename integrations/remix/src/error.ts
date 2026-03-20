import {
  WorkkitError,
  isWorkkitError,
  RateLimitError,
  InternalError,
} from '@workkit/errors'
import type { ErrorHandlerOptions } from './types'

/**
 * Creates an error handler function for Remix error boundaries.
 *
 * Returns a function that takes an unknown error and produces a Response:
 * - WorkkitError instances are handled by onWorkkitError (or default JSON response)
 * - Other Error instances are handled by onError (or wrapped as InternalError)
 * - Non-Error values are wrapped as InternalError
 *
 * @example
 * ```ts
 * import { createErrorHandler } from '@workkit/remix'
 *
 * const handleError = createErrorHandler({
 *   onWorkkitError: (error) => {
 *     return new Response(error.message, { status: error.statusCode })
 *   },
 * })
 *
 * // In error boundary:
 * export function ErrorBoundary() {
 *   const error = useRouteError()
 *   // use handleError for server-side error responses
 * }
 * ```
 */
export function createErrorHandler(
  options: ErrorHandlerOptions = {},
): (error: unknown) => Response | Promise<Response> {
  const { onWorkkitError, onError, includeStack = false } = options

  return async (error: unknown): Promise<Response> => {
    if (isWorkkitError(error)) {
      if (onWorkkitError) {
        return onWorkkitError(error)
      }
      return workkitErrorToResponse(error, includeStack)
    }

    if (error instanceof Error) {
      if (onError) {
        return onError(error)
      }
      // Wrap as InternalError
      const wrapped = new InternalError(error.message, { cause: error })
      return workkitErrorToResponse(wrapped, includeStack)
    }

    // Non-Error value
    const wrapped = new InternalError(
      typeof error === 'string' ? error : 'An unexpected error occurred',
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

  if ('issues' in error && Array.isArray((error as any).issues)) {
    ;(body.error as any).issues = (error as any).issues
  }

  if (includeStack && error.stack) {
    ;(body.error as any).stack = error.stack
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (error instanceof RateLimitError && error.retryAfterMs) {
    headers['Retry-After'] = String(Math.ceil(error.retryAfterMs / 1000))
  }

  return new Response(JSON.stringify(body), {
    status: error.statusCode,
    headers,
  })
}
