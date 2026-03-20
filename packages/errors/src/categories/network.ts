import { WorkkitError } from '../base'
import type { RetryStrategy, WorkkitErrorOptions } from '../types'

export class TimeoutError extends WorkkitError {
  readonly code = 'WORKKIT_TIMEOUT' as const
  readonly statusCode = 504
  readonly retryable = true
  readonly defaultRetryStrategy: RetryStrategy = {
    kind: 'exponential',
    baseMs: 500,
    maxMs: 10000,
    maxAttempts: 3,
  }

  constructor(operation: string, timeoutMs?: number, options?: WorkkitErrorOptions) {
    const msg = timeoutMs
      ? `${operation} timed out after ${timeoutMs}ms`
      : `${operation} timed out`
    super(msg, { ...options, context: { ...options?.context, operation, timeoutMs } })
  }
}

export class RateLimitError extends WorkkitError {
  readonly code = 'WORKKIT_RATE_LIMIT' as const
  readonly statusCode = 429
  readonly retryable = true
  readonly defaultRetryStrategy: RetryStrategy = {
    kind: 'fixed',
    delayMs: 1000,
    maxAttempts: 3,
  }

  /** When the rate limit resets (if known) */
  readonly retryAfterMs?: number

  constructor(message?: string, retryAfterMs?: number, options?: WorkkitErrorOptions) {
    super(message ?? 'Rate limit exceeded', {
      ...options,
      context: { ...options?.context, retryAfterMs },
      // If retryAfter is known, use it as the fixed delay
      retryStrategy: retryAfterMs
        ? { kind: 'fixed', delayMs: retryAfterMs, maxAttempts: 3 }
        : options?.retryStrategy,
    })
    this.retryAfterMs = retryAfterMs
  }
}

export class ServiceUnavailableError extends WorkkitError {
  readonly code = 'WORKKIT_SERVICE_UNAVAILABLE' as const
  readonly statusCode = 503
  readonly retryable = true
  readonly defaultRetryStrategy: RetryStrategy = {
    kind: 'exponential',
    baseMs: 1000,
    maxMs: 30000,
    maxAttempts: 5,
  }

  constructor(service: string, options?: WorkkitErrorOptions) {
    super(`${service} is temporarily unavailable`, {
      ...options,
      context: { ...options?.context, service },
    })
  }
}
