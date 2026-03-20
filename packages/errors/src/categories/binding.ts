import { WorkkitError } from '../base'
import type { RetryStrategy, WorkkitErrorOptions } from '../types'

export class BindingError extends WorkkitError {
  readonly code = 'WORKKIT_BINDING_ERROR' as const
  readonly statusCode = 500
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(message: string, options?: WorkkitErrorOptions) {
    super(message, options)
  }
}

export class BindingNotFoundError extends WorkkitError {
  readonly code = 'WORKKIT_BINDING_NOT_FOUND' as const
  readonly statusCode = 500
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  /** Name of the missing binding */
  readonly bindingName: string

  constructor(bindingName: string, options?: WorkkitErrorOptions) {
    super(
      `Binding "${bindingName}" not found in environment. Check your wrangler.toml configuration.`,
      { ...options, context: { ...options?.context, bindingName } },
    )
    this.bindingName = bindingName
  }
}
