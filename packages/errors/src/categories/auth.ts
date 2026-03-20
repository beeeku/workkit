import { WorkkitError } from '../base'
import type { RetryStrategy, WorkkitErrorOptions } from '../types'

export class UnauthorizedError extends WorkkitError {
  readonly code = 'WORKKIT_UNAUTHORIZED' as const
  readonly statusCode = 401
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(message?: string, options?: WorkkitErrorOptions) {
    super(message ?? 'Authentication required', options)
  }
}

export class ForbiddenError extends WorkkitError {
  readonly code = 'WORKKIT_FORBIDDEN' as const
  readonly statusCode = 403
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(message?: string, options?: WorkkitErrorOptions) {
    super(message ?? 'Insufficient permissions', options)
  }
}
