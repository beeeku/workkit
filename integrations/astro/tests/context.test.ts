import { describe, it, expect, vi } from 'vitest'
import { getCFProperties, getWaitUntil } from '../src/context'
import { getCloudflareRuntime } from '../src/context'
import {
  createMockContext,
  createMockContextWithoutRuntime,
} from './helpers'

describe('getCFProperties', () => {
  it('returns cf properties when available', () => {
    const cf = {
      country: 'US',
      city: 'San Francisco',
      colo: 'SFO',
      continent: 'NA',
      latitude: '37.7749',
      longitude: '-122.4194',
      timezone: 'America/Los_Angeles',
    }
    const context = createMockContext({ env: {}, cf })

    const result = getCFProperties(context)

    expect(result).toBeDefined()
    expect(result!.country).toBe('US')
    expect(result!.city).toBe('San Francisco')
    expect(result!.colo).toBe('SFO')
  })

  it('returns undefined when cf is not available', () => {
    const context = createMockContext({ env: {} })

    const result = getCFProperties(context)

    expect(result).toBeUndefined()
  })

  it('returns undefined when runtime is not available', () => {
    const context = createMockContextWithoutRuntime()

    const result = getCFProperties(context)

    expect(result).toBeUndefined()
  })

  it('provides access to geographic properties', () => {
    const cf = {
      country: 'DE',
      region: 'Hesse',
      regionCode: 'HE',
      postalCode: '60313',
    }
    const context = createMockContext({ env: {}, cf })

    const result = getCFProperties(context)

    expect(result!.country).toBe('DE')
    expect(result!.region).toBe('Hesse')
    expect(result!.regionCode).toBe('HE')
    expect(result!.postalCode).toBe('60313')
  })

  it('provides access to network properties', () => {
    const cf = {
      httpProtocol: 'HTTP/2',
      tlsVersion: 'TLSv1.3',
      asn: 13335,
      asOrganization: 'Cloudflare',
    }
    const context = createMockContext({ env: {}, cf })

    const result = getCFProperties(context)

    expect(result!.httpProtocol).toBe('HTTP/2')
    expect(result!.tlsVersion).toBe('TLSv1.3')
    expect(result!.asn).toBe(13335)
    expect(result!.asOrganization).toBe('Cloudflare')
  })

  it('allows access to additional cf properties via index signature', () => {
    const cf = { country: 'JP', customProp: 'custom-value' }
    const context = createMockContext({ env: {}, cf })

    const result = getCFProperties(context)

    expect(result!['customProp']).toBe('custom-value')
  })
})

describe('getWaitUntil', () => {
  it('returns the waitUntil function', () => {
    const waitUntilFn = vi.fn()
    const context = createMockContext({
      env: {},
      ctx: { waitUntil: waitUntilFn },
    })

    const waitUntil = getWaitUntil(context)

    expect(typeof waitUntil).toBe('function')
  })

  it('returned function calls the underlying waitUntil', () => {
    const waitUntilFn = vi.fn()
    const context = createMockContext({
      env: {},
      ctx: { waitUntil: waitUntilFn },
    })

    const waitUntil = getWaitUntil(context)
    const promise = Promise.resolve('done')
    waitUntil(promise)

    expect(waitUntilFn).toHaveBeenCalledWith(promise)
  })

  it('can be called multiple times', () => {
    const waitUntilFn = vi.fn()
    const context = createMockContext({
      env: {},
      ctx: { waitUntil: waitUntilFn },
    })

    const waitUntil = getWaitUntil(context)
    waitUntil(Promise.resolve('a'))
    waitUntil(Promise.resolve('b'))
    waitUntil(Promise.resolve('c'))

    expect(waitUntilFn).toHaveBeenCalledTimes(3)
  })

  it('throws when runtime is not available', () => {
    const context = createMockContextWithoutRuntime()

    expect(() => getWaitUntil(context)).toThrow('Cloudflare runtime not found')
  })

  it('throws when execution context is not available', () => {
    const context = createMockContext({ env: {} })

    expect(() => getWaitUntil(context)).toThrow('waitUntil not available')
  })

  it('throws when ctx exists but waitUntil is missing', () => {
    const context = createMockContext({
      env: {},
      ctx: {} as any,
    })

    expect(() => getWaitUntil(context)).toThrow('waitUntil not available')
  })
})

describe('getCloudflareRuntime', () => {
  it('returns the runtime when available', () => {
    const context = createMockContext({ env: { KEY: 'val' } })

    const runtime = getCloudflareRuntime(context)

    expect(runtime).toBeDefined()
    expect(runtime.env).toStrictEqual({ KEY: 'val' })
  })

  it('throws ConfigError when runtime is missing', () => {
    const context = createMockContextWithoutRuntime()

    expect(() => getCloudflareRuntime(context)).toThrow('Cloudflare runtime not found')
  })

  it('throws with helpful message about adapter', () => {
    const context = createMockContextWithoutRuntime()

    expect(() => getCloudflareRuntime(context)).toThrow('@astrojs/cloudflare')
  })

  it('includes cf and ctx when available', () => {
    const waitUntilFn = vi.fn()
    const context = createMockContext({
      env: {},
      cf: { country: 'US' },
      ctx: { waitUntil: waitUntilFn },
    })

    const runtime = getCloudflareRuntime(context)

    expect(runtime.cf).toBeDefined()
    expect(runtime.ctx).toBeDefined()
  })
})
