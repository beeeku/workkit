import { describe, it, expect, vi } from 'vitest'
import {
  RetryStrategies,
  getRetryDelay,
  isRetryable,
  getRetryStrategy,
} from '../src/retry'
import type { RetryStrategy } from '../src/types'
import { WorkkitError } from '../src/base'

// Concrete subclasses for testing
class RetryableError extends WorkkitError {
  readonly code = 'WORKKIT_TIMEOUT' as const
  readonly statusCode = 504
  readonly retryable = true
  readonly defaultRetryStrategy: RetryStrategy = {
    kind: 'exponential',
    baseMs: 500,
    maxMs: 10000,
    maxAttempts: 3,
  }
}

class NonRetryableError extends WorkkitError {
  readonly code = 'WORKKIT_NOT_FOUND' as const
  readonly statusCode = 404
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }
}

describe('RetryStrategies', () => {
  it('none() returns none strategy', () => {
    expect(RetryStrategies.none()).toEqual({ kind: 'none' })
  })

  it('immediate() with default maxAttempts', () => {
    expect(RetryStrategies.immediate()).toEqual({ kind: 'immediate', maxAttempts: 3 })
  })

  it('immediate() with custom maxAttempts', () => {
    expect(RetryStrategies.immediate(5)).toEqual({ kind: 'immediate', maxAttempts: 5 })
  })

  it('fixed() with default params', () => {
    expect(RetryStrategies.fixed()).toEqual({ kind: 'fixed', delayMs: 1000, maxAttempts: 3 })
  })

  it('fixed() with custom params', () => {
    expect(RetryStrategies.fixed(500, 10)).toEqual({ kind: 'fixed', delayMs: 500, maxAttempts: 10 })
  })

  it('exponential() with default params', () => {
    expect(RetryStrategies.exponential()).toEqual({
      kind: 'exponential',
      baseMs: 500,
      maxMs: 30000,
      maxAttempts: 5,
    })
  })

  it('exponential() with custom params', () => {
    expect(RetryStrategies.exponential(100, 5000, 3)).toEqual({
      kind: 'exponential',
      baseMs: 100,
      maxMs: 5000,
      maxAttempts: 3,
    })
  })
})

describe('getRetryDelay', () => {
  it('returns null for none strategy', () => {
    expect(getRetryDelay({ kind: 'none' }, 1)).toBeNull()
  })

  it('returns 0 for immediate within maxAttempts', () => {
    const strategy: RetryStrategy = { kind: 'immediate', maxAttempts: 3 }
    expect(getRetryDelay(strategy, 1)).toBe(0)
    expect(getRetryDelay(strategy, 2)).toBe(0)
    expect(getRetryDelay(strategy, 3)).toBe(0)
  })

  it('returns null for immediate beyond maxAttempts', () => {
    const strategy: RetryStrategy = { kind: 'immediate', maxAttempts: 3 }
    expect(getRetryDelay(strategy, 4)).toBeNull()
  })

  it('returns fixed delay within maxAttempts', () => {
    const strategy: RetryStrategy = { kind: 'fixed', delayMs: 1000, maxAttempts: 3 }
    expect(getRetryDelay(strategy, 1)).toBe(1000)
    expect(getRetryDelay(strategy, 3)).toBe(1000)
  })

  it('returns null for fixed beyond maxAttempts', () => {
    const strategy: RetryStrategy = { kind: 'fixed', delayMs: 1000, maxAttempts: 3 }
    expect(getRetryDelay(strategy, 4)).toBeNull()
  })

  it('exponential doubles delay each attempt (approximately)', () => {
    const strategy: RetryStrategy = {
      kind: 'exponential',
      baseMs: 100,
      maxMs: 100000,
      maxAttempts: 5,
    }
    // Mock Math.random to remove jitter for deterministic testing
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // jitter = 0 when random = 0.5

    const delay1 = getRetryDelay(strategy, 1)! // 100 * 2^0 = 100
    const delay2 = getRetryDelay(strategy, 2)! // 100 * 2^1 = 200
    const delay3 = getRetryDelay(strategy, 3)! // 100 * 2^2 = 400

    expect(delay1).toBe(100)
    expect(delay2).toBe(200)
    expect(delay3).toBe(400)

    vi.restoreAllMocks()
  })

  it('exponential caps at maxMs', () => {
    const strategy: RetryStrategy = {
      kind: 'exponential',
      baseMs: 1000,
      maxMs: 2000,
      maxAttempts: 10,
    }
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    // attempt 3: 1000 * 2^2 = 4000 -> capped at 2000
    const delay = getRetryDelay(strategy, 3)!
    expect(delay).toBe(2000)

    vi.restoreAllMocks()
  })

  it('exponential returns null beyond maxAttempts', () => {
    const strategy: RetryStrategy = {
      kind: 'exponential',
      baseMs: 100,
      maxMs: 10000,
      maxAttempts: 3,
    }
    expect(getRetryDelay(strategy, 4)).toBeNull()
  })

  it('exponential applies jitter (±25%)', () => {
    const strategy: RetryStrategy = {
      kind: 'exponential',
      baseMs: 1000,
      maxMs: 100000,
      maxAttempts: 5,
    }

    // Test with many random values to verify jitter range
    const delays: number[] = []
    for (let i = 0; i < 100; i++) {
      const delay = getRetryDelay(strategy, 1)!
      delays.push(delay)
    }

    // Base delay for attempt 1 = 1000ms, jitter ±25% = [750, 1250]
    const min = Math.min(...delays)
    const max = Math.max(...delays)
    expect(min).toBeGreaterThanOrEqual(750)
    expect(max).toBeLessThanOrEqual(1250)
    // Verify there's actual variation (not all the same)
    expect(new Set(delays).size).toBeGreaterThan(1)
  })
})

describe('isRetryable', () => {
  it('returns true for retryable WorkkitErrors', () => {
    expect(isRetryable(new RetryableError('timeout'))).toBe(true)
  })

  it('returns false for non-retryable WorkkitErrors', () => {
    expect(isRetryable(new NonRetryableError('not found'))).toBe(false)
  })

  it('returns false for native Errors', () => {
    expect(isRetryable(new Error('plain error'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isRetryable('string error')).toBe(false)
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
    expect(isRetryable(42)).toBe(false)
  })
})

describe('getRetryStrategy', () => {
  it('extracts strategy from WorkkitError', () => {
    const error = new RetryableError('timeout')
    expect(getRetryStrategy(error)).toEqual({
      kind: 'exponential',
      baseMs: 500,
      maxMs: 10000,
      maxAttempts: 3,
    })
  })

  it('returns none for native Errors', () => {
    expect(getRetryStrategy(new Error('plain'))).toEqual({ kind: 'none' })
  })

  it('returns none for non-Error values', () => {
    expect(getRetryStrategy('string')).toEqual({ kind: 'none' })
  })
})
