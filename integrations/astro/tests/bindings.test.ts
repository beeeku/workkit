import { describe, it, expect } from 'vitest'
import { getBinding, getOptionalBinding } from '../src/bindings'
import {
  createMockContext,
  createMockContextWithoutRuntime,
  createMockKV,
  createMockD1,
} from './helpers'

describe('getBinding', () => {
  describe('typed access', () => {
    it('returns the binding by name', () => {
      const mockKV = createMockKV()
      const context = createMockContext({ env: { CACHE: mockKV } })

      const result = getBinding(context, 'CACHE')

      expect(result).toBe(mockKV)
    })

    it('returns D1-like binding', () => {
      const mockD1 = createMockD1()
      const context = createMockContext({ env: { DB: mockD1 } })

      const result = getBinding(context, 'DB')

      expect(result).toBe(mockD1)
    })

    it('returns string bindings (env vars)', () => {
      const context = createMockContext({ env: { API_KEY: 'secret-123' } })

      const result = getBinding<string>(context, 'API_KEY')

      expect(result).toBe('secret-123')
    })

    it('returns numeric bindings', () => {
      const context = createMockContext({ env: { PORT: 8080 } })

      const result = getBinding<number>(context, 'PORT')

      expect(result).toBe(8080)
    })

    it('returns object bindings', () => {
      const obj = { key: 'value', nested: { a: 1 } }
      const context = createMockContext({ env: { CONFIG: obj } })

      const result = getBinding(context, 'CONFIG')

      expect(result).toStrictEqual(obj)
    })
  })

  describe('missing binding error', () => {
    it('throws BindingNotFoundError when binding does not exist', () => {
      const context = createMockContext({ env: {} })

      expect(() => getBinding(context, 'MISSING')).toThrow()
    })

    it('error message contains the binding name', () => {
      const context = createMockContext({ env: {} })

      expect(() => getBinding(context, 'MY_BINDING')).toThrow('MY_BINDING')
    })

    it('throws when binding is explicitly undefined', () => {
      const context = createMockContext({ env: { CACHE: undefined } })

      expect(() => getBinding(context, 'CACHE')).toThrow()
    })
  })

  describe('runtime errors', () => {
    it('throws ConfigError when runtime is not available', () => {
      const context = createMockContextWithoutRuntime()

      expect(() => getBinding(context, 'CACHE')).toThrow('Cloudflare runtime not found')
    })
  })
})

describe('getOptionalBinding', () => {
  it('returns the binding when it exists', () => {
    const mockKV = createMockKV()
    const context = createMockContext({ env: { CACHE: mockKV } })

    const result = getOptionalBinding(context, 'CACHE')

    expect(result).toBe(mockKV)
  })

  it('returns undefined when binding does not exist', () => {
    const context = createMockContext({ env: {} })

    const result = getOptionalBinding(context, 'MISSING')

    expect(result).toBeUndefined()
  })

  it('returns undefined when runtime is not available', () => {
    const context = createMockContextWithoutRuntime()

    const result = getOptionalBinding(context, 'CACHE')

    expect(result).toBeUndefined()
  })

  it('returns string bindings', () => {
    const context = createMockContext({ env: { KEY: 'value' } })

    const result = getOptionalBinding<string>(context, 'KEY')

    expect(result).toBe('value')
  })

  it('distinguishes between undefined and null bindings', () => {
    const context = createMockContext({ env: { NULLABLE: null } })

    // null is a valid value (binding exists but is null)
    const result = getOptionalBinding(context, 'NULLABLE')
    expect(result).toBeNull()
  })

  it('returns undefined for explicitly undefined values', () => {
    const context = createMockContext({ env: { UNDEF: undefined } })

    const result = getOptionalBinding(context, 'UNDEF')
    expect(result).toBeUndefined()
  })
})
