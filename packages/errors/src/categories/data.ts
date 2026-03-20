import { WorkkitError } from '../base'
import type { RetryStrategy, WorkkitErrorOptions } from '../types'

export class NotFoundError extends WorkkitError {
  readonly code = 'WORKKIT_NOT_FOUND' as const
  readonly statusCode = 404
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  constructor(resource: string, identifier?: string, options?: WorkkitErrorOptions) {
    const msg = identifier
      ? `${resource} "${identifier}" not found`
      : `${resource} not found`
    super(msg, { ...options, context: { ...options?.context, resource, identifier } })
  }
}

export class ConflictError extends WorkkitError {
  readonly code = 'WORKKIT_CONFLICT' as const
  readonly statusCode = 409
  readonly retryable = true
  readonly defaultRetryStrategy: RetryStrategy = {
    kind: 'exponential',
    baseMs: 100,
    maxMs: 5000,
    maxAttempts: 3,
  }

  constructor(message: string, options?: WorkkitErrorOptions) {
    super(message, options)
  }
}

export class ValidationError extends WorkkitError {
  readonly code = 'WORKKIT_VALIDATION' as const
  readonly statusCode = 400
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  /** Structured validation issues */
  readonly issues: ValidationIssue[]

  constructor(message: string, issues?: ValidationIssue[], options?: WorkkitErrorOptions) {
    super(message, {
      ...options,
      context: { ...options?.context, issues },
    })
    this.issues = issues ?? []
  }
}

export interface ValidationIssue {
  path: string[]
  message: string
  code?: string
}
