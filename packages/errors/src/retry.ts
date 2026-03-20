import type { RetryStrategy } from './types'
import { WorkkitError } from './base'

/** Default retry strategies — importable for custom error types */
export const RetryStrategies = {
  none: (): RetryStrategy => ({ kind: 'none' }),

  immediate: (maxAttempts = 3): RetryStrategy => ({
    kind: 'immediate',
    maxAttempts,
  }),

  fixed: (delayMs = 1000, maxAttempts = 3): RetryStrategy => ({
    kind: 'fixed',
    delayMs,
    maxAttempts,
  }),

  exponential: (
    baseMs = 500,
    maxMs = 30000,
    maxAttempts = 5,
  ): RetryStrategy => ({
    kind: 'exponential',
    baseMs,
    maxMs,
    maxAttempts,
  }),
} as const

/**
 * Calculate delay for a given attempt using the error's retry strategy.
 * Returns null if no more retries should be attempted.
 *
 * @param strategy - The retry strategy to use
 * @param attempt - Current attempt number (1-based: 1 = first retry)
 * @returns Delay in ms before next retry, or null if no more retries
 */
export function getRetryDelay(strategy: RetryStrategy, attempt: number): number | null {
  switch (strategy.kind) {
    case 'none':
      return null

    case 'immediate':
      return attempt <= strategy.maxAttempts ? 0 : null

    case 'fixed':
      return attempt <= strategy.maxAttempts ? strategy.delayMs : null

    case 'exponential': {
      if (attempt > strategy.maxAttempts) return null
      // 2^(attempt-1) * baseMs, capped at maxMs, with jitter
      const delay = Math.min(
        strategy.baseMs * Math.pow(2, attempt - 1),
        strategy.maxMs,
      )
      // Add ±25% jitter to prevent thundering herd
      const jitter = delay * 0.25 * (Math.random() * 2 - 1)
      return Math.max(0, Math.round(delay + jitter))
    }
  }
}

/**
 * Check if an error (workkit or unknown) is retryable.
 * Useful for catch blocks that handle mixed error types.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof WorkkitError) {
    return error.retryable
  }
  return false
}

/**
 * Get retry strategy from an error (workkit or unknown).
 * Returns 'none' strategy for non-workkit errors.
 */
export function getRetryStrategy(error: unknown): RetryStrategy {
  if (error instanceof WorkkitError) {
    return error.retryStrategy
  }
  return { kind: 'none' }
}
