import { describe, it, expect } from 'vitest'
import { createExecutionContext } from '../src/context'

describe('createExecutionContext', () => {
  it('returns an object with waitUntil and passThroughOnException', () => {
    const ctx = createExecutionContext()
    expect(typeof ctx.waitUntil).toBe('function')
    expect(typeof ctx.passThroughOnException).toBe('function')
  })

  it('waitUntil collects promises in _promises', () => {
    const ctx = createExecutionContext()
    const p1 = Promise.resolve(1)
    const p2 = Promise.resolve(2)
    ctx.waitUntil(p1)
    ctx.waitUntil(p2)
    expect(ctx._promises).toHaveLength(2)
    expect(ctx._promises[0]).toBe(p1)
    expect(ctx._promises[1]).toBe(p2)
  })

  it('passThroughOnException is a no-op', () => {
    const ctx = createExecutionContext()
    expect(() => ctx.passThroughOnException()).not.toThrow()
  })

  it('_promises starts empty', () => {
    const ctx = createExecutionContext()
    expect(ctx._promises).toEqual([])
  })

  it('waitUntil handles rejected promises without throwing', () => {
    const ctx = createExecutionContext()
    const rejected = Promise.reject(new Error('test'))
    // waitUntil should not throw synchronously
    expect(() => ctx.waitUntil(rejected)).not.toThrow()
    expect(ctx._promises).toHaveLength(1)
    // Prevent unhandled rejection
    rejected.catch(() => {})
  })
})
