import { describe, it, expect } from 'vitest'
import { assertKVBinding, assertValidTtl, wrapKVError } from '../src/errors'
import {
  BindingNotFoundError,
  ConfigError,
  ValidationError,
  TimeoutError,
  ServiceUnavailableError,
  InternalError,
} from '@workkit/errors'

describe('assertKVBinding', () => {
  it('passes for valid KVNamespace-shaped object', () => {
    const mock = { get: () => {}, put: () => {}, delete: () => {}, list: () => {} }
    expect(() => assertKVBinding(mock)).not.toThrow()
  })

  it('throws BindingNotFoundError for null', () => {
    expect(() => assertKVBinding(null)).toThrow(BindingNotFoundError)
  })

  it('throws BindingNotFoundError for undefined', () => {
    expect(() => assertKVBinding(undefined)).toThrow(BindingNotFoundError)
  })

  it('throws ConfigError for plain object without KV methods', () => {
    expect(() => assertKVBinding({ foo: 'bar' })).toThrow(ConfigError)
  })
})

describe('assertValidTtl', () => {
  it('passes for undefined (no TTL)', () => {
    expect(() => assertValidTtl(undefined)).not.toThrow()
  })

  it('passes for TTL >= 60', () => {
    expect(() => assertValidTtl(60)).not.toThrow()
    expect(() => assertValidTtl(3600)).not.toThrow()
  })

  it('throws ValidationError for TTL < 60', () => {
    expect(() => assertValidTtl(30)).toThrow(ValidationError)
  })

  it('error message includes the received TTL value', () => {
    expect(() => assertValidTtl(10)).toThrow(/10/)
  })
})

describe('wrapKVError', () => {
  it('wraps timeout errors as TimeoutError', () => {
    expect(() =>
      wrapKVError(new Error('operation timed out'), { operation: 'get' }),
    ).toThrow(TimeoutError)
  })

  it('wraps service errors as ServiceUnavailableError', () => {
    expect(() =>
      wrapKVError(new Error('503 service unavailable'), { operation: 'get' }),
    ).toThrow(ServiceUnavailableError)
  })

  it('wraps unknown errors as InternalError', () => {
    expect(() =>
      wrapKVError(new Error('something weird'), { operation: 'get' }),
    ).toThrow(InternalError)
  })

  it('preserves original error as cause', () => {
    const original = new Error('timeout')
    try {
      wrapKVError(original, { operation: 'get' })
    } catch (err: any) {
      expect(err.cause).toBe(original)
    }
  })

  it('includes KV context in error', () => {
    try {
      wrapKVError(new Error('fail'), { operation: 'put', key: 'user:123', prefix: 'user:' })
    } catch (err: any) {
      expect(err.context?.operation).toBe('put')
      expect(err.context?.key).toBe('user:123')
    }
  })
})
