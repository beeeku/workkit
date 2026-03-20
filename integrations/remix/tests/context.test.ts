import { describe, it, expect } from 'vitest'
import { getCFContext } from '../src/context'
import { createMockContext } from './helpers'

describe('getCFContext', () => {
  it('should extract waitUntil function', () => {
    const context = createMockContext()
    const cf = getCFContext(context)

    expect(typeof cf.waitUntil).toBe('function')
  })

  it('should extract passThroughOnException function', () => {
    const context = createMockContext()
    const cf = getCFContext(context)

    expect(typeof cf.passThroughOnException).toBe('function')
  })

  it('should return cf properties when available', () => {
    const cfProps = { country: 'US', colo: 'SJC' } as unknown as IncomingRequestCfProperties
    const context = createMockContext({}, { cf: cfProps })
    const cf = getCFContext(context)

    expect(cf.cf).toBeDefined()
    expect((cf.cf as any).country).toBe('US')
    expect((cf.cf as any).colo).toBe('SJC')
  })

  it('should return undefined cf when not available', () => {
    const context = createMockContext()
    const cf = getCFContext(context)

    expect(cf.cf).toBeUndefined()
  })

  it('should correctly call waitUntil', () => {
    const waitUntilFns: Array<Promise<unknown>> = []
    const context = createMockContext({}, { waitUntilFns })
    const cf = getCFContext(context)

    const promise = Promise.resolve('done')
    cf.waitUntil(promise)

    expect(waitUntilFns).toHaveLength(1)
    expect(waitUntilFns[0]).toBe(promise)
  })

  it('should track multiple waitUntil calls', () => {
    const waitUntilFns: Array<Promise<unknown>> = []
    const context = createMockContext({}, { waitUntilFns })
    const cf = getCFContext(context)

    cf.waitUntil(Promise.resolve('a'))
    cf.waitUntil(Promise.resolve('b'))
    cf.waitUntil(Promise.resolve('c'))

    expect(waitUntilFns).toHaveLength(3)
  })

  it('should preserve binding of waitUntil to ctx', () => {
    const waitUntilFns: Array<Promise<unknown>> = []
    const context = createMockContext({}, { waitUntilFns })
    const { waitUntil } = getCFContext(context)

    // Destructured call should still work
    waitUntil(Promise.resolve('test'))
    expect(waitUntilFns).toHaveLength(1)
  })

  it('should preserve binding of passThroughOnException to ctx', () => {
    const context = createMockContext()
    const { passThroughOnException } = getCFContext(context)

    // Should not throw when destructured and called
    expect(() => passThroughOnException()).not.toThrow()
  })
})
