import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slidingWindow } from '../src/sliding-window'
import { createMockKV } from './helpers/mock-kv'

describe('slidingWindow', () => {
  let kv: ReturnType<typeof createMockKV>

  beforeEach(() => {
    kv = createMockKV()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows first request', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 10, window: '1m' })
    const result = await limiter.check('user:1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
    expect(result.limit).toBe(10)
  })

  it('decrements remaining on each request', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 5, window: '1m' })

    const r1 = await limiter.check('user:1')
    expect(r1.remaining).toBe(4)

    const r2 = await limiter.check('user:1')
    expect(r2.remaining).toBe(3)
  })

  it('blocks requests over the limit', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const r3 = await limiter.check('user:1')
    expect(r3.allowed).toBe(false)
    expect(r3.remaining).toBe(0)
  })

  it('tracks different keys independently', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(false)

    const r2 = await limiter.check('user:2')
    expect(r2.allowed).toBe(true)
  })

  it('uses weighted average across window boundary', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 10, window: '1m' })

    // Use 8 requests in first window
    for (let i = 0; i < 8; i++) {
      await limiter.check('user:1')
    }

    // Move 30 seconds into the next window (50% through)
    vi.advanceTimersByTime(60_000 + 30_000)

    // Weighted count = 8 * 0.5 (previous window weight) + 0 (current window) = 4
    // So remaining should be ~6, allowed should be true
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    // After the check, current window count is 1
    // Weighted = 8 * 0.5 + 1 = 5, remaining = 10 - 5 = 5
    expect(result.remaining).toBe(5)
  })

  it('previous window weight decreases over time', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 10, window: '1m' })

    // Fill up with 10 requests
    for (let i = 0; i < 10; i++) {
      await limiter.check('user:1')
    }

    // Blocked at end of current window
    const blocked = await limiter.check('user:1')
    expect(blocked.allowed).toBe(false)

    // Move 45 seconds into next window (75% through)
    vi.advanceTimersByTime(60_000 + 45_000)

    // Weighted count = 10 * 0.25 (previous) + 0 (current) = 2.5 → floor = 2
    // Remaining = 10 - 2 - 1(this request) = 7
    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeGreaterThanOrEqual(6)
  })

  it('fully resets after two full windows', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const blocked = await limiter.check('user:1')
    expect(blocked.allowed).toBe(false)

    // Advance past two full windows
    vi.advanceTimersByTime(121_000)

    const result = await limiter.check('user:1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(1)
  })

  it('sets correct resetAt timestamp', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 10, window: '1m' })
    const result = await limiter.check('user:1')

    expect(result.resetAt).toBeInstanceOf(Date)
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('uses custom prefix for KV keys', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 10, window: '1m', prefix: 'slide:' })
    await limiter.check('user:1')

    const keys = [...kv._store.keys()]
    expect(keys.some(k => k.startsWith('slide:'))).toBe(true)
  })

  it('handles limit of 1', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 1, window: '1s' })

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(0)

    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(false)
  })

  it('remaining never goes below zero', async () => {
    const limiter = slidingWindow({ namespace: kv, limit: 1, window: '1m' })

    await limiter.check('user:1')

    const r2 = await limiter.check('user:1')
    expect(r2.remaining).toBe(0)

    const r3 = await limiter.check('user:1')
    expect(r3.remaining).toBe(0)
  })
})
