import { WorkkitError } from '../base'
import type { RetryStrategy, WorkkitErrorOptions } from '../types'

export class InternalError extends WorkkitError {
  readonly code = 'WORKKIT_INTERNAL' as const
  readonly statusCode = 500
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(message: string, options?: WorkkitErrorOptions) {
    super(message, options)
  }
}

export class ConfigError extends WorkkitError {
  readonly code = 'WORKKIT_CONFIG' as const
  readonly statusCode = 500
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(message: string, options?: WorkkitErrorOptions) {
    super(message, options)
  }
}
