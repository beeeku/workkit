import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fixedWindow } from '../src/fixed-window'
import { createMockKV } from './helpers/mock-kv'

describe('fixedWindow', () => {
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
    const limiter = fixedWindow({ namespace: kv, limit: 10, window: '1m' })
    const result = await limiter.check('user:1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
    expect(result.limit).toBe(10)
    expect(result.resetAt).toBeInstanceOf(Date)
  })

  it('decrements remaining on each request', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 5, window: '1m' })

    const r1 = await limiter.check('user:1')
    expect(r1.remaining).toBe(4)

    const r2 = await limiter.check('user:1')
    expect(r2.remaining).toBe(3)

    const r3 = await limiter.check('user:1')
    expect(r3.remaining).toBe(2)
  })

  it('allows requests up to the limit', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 3, window: '1m' })

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = await limiter.check('user:1')
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('blocks requests over the limit', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const r3 = await limiter.check('user:1')
    expect(r3.allowed).toBe(false)
    expect(r3.remaining).toBe(0)
  })

  it('tracks different keys independently', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(false)

    const r2 = await limiter.check('user:2')
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)
  })

  it('resets after window expires', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 2, window: '1m' })

    await limiter.check('user:1')
    await limiter.check('user:1')

    const blocked = await limiter.check('user:1')
    expect(blocked.allowed).toBe(false)

    // Advance past the 1-minute window
    vi.advanceTimersByTime(61_000)

    const r = await limiter.check('user:1')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(1)
  })

  it('sets correct resetAt timestamp', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 10, window: '1m' })
    const result = await limiter.check('user:1')

    const now = Date.now()
    const expectedReset = new Date(now + 60_000)
    expect(result.resetAt.getTime()).toBe(expectedReset.getTime())
  })

  it('uses custom prefix for KV keys', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 10, window: '1m', prefix: 'api:' })
    await limiter.check('user:1')

    const keys = [...kv._store.keys()]
    expect(keys.some(k => k.startsWith('api:'))).toBe(true)
  })

  it('handles limit of 1', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 1, window: '1s' })

    const r1 = await limiter.check('user:1')
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(0)

    const r2 = await limiter.check('user:1')
    expect(r2.allowed).toBe(false)
    expect(r2.remaining).toBe(0)
  })

  it('handles large limits', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 1_000_000, window: '1h' })

    const r = await limiter.check('user:1')
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(999_999)
    expect(r.limit).toBe(1_000_000)
  })

  it('remaining never goes below zero', async () => {
    const limiter = fixedWindow({ namespace: kv, limit: 1, window: '1m' })

    await limiter.check('user:1')

    const r2 = await limiter.check('user:1')
    expect(r2.remaining).toBe(0)

    const r3 = await limiter.check('user:1')
    expect(r3.remaining).toBe(0)
  })
})
