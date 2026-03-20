import { describe, it, expect } from 'vitest'
import { serializeError, wrapError } from '../src/serialize'
import { WorkkitError } from '../src/base'
import { InternalError } from '../src/categories/internal'
import { NotFoundError } from '../src/categories/data'
import type { SerializedError } from '../src/types'

describe('serializeError', () => {
  it('handles WorkkitError', () => {
    const error = new NotFoundError('User', '123')
    const result = serializeError(error)
    expect('code' in result).toBe(true)
    const serialized = result as SerializedError
    expect(serialized.code).toBe('WORKKIT_NOT_FOUND')
    expect(serialized.message).toBe('User "123" not found')
    expect(serialized.statusCode).toBe(404)
    expect(serialized.retryable).toBe(false)
    expect(typeof serialized.timestamp).toBe('string')
  })

  it('handles native Error (name + message)', () => {
    const error = new TypeError('bad type')
    const result = serializeError(error)
    expect(result).toEqual({ name: 'TypeError', message: 'bad type' })
  })

  it('handles non-Error (string coercion)', () => {
    const result = serializeError('something went wrong')
    expect(result).toEqual({ name: 'UnknownError', message: 'something went wrong' })
  })

  it('handles null/undefined', () => {
    expect(serializeError(null)).toEqual({ name: 'UnknownError', message: 'null' })
    expect(serializeError(undefined)).toEqual({ name: 'UnknownError', message: 'undefined' })
  })
})

describe('wrapError', () => {
  it('passes through WorkkitError unchanged', () => {
    const error = new NotFoundError('User', '123')
    const wrapped = wrapError(error)
    expect(wrapped).toBe(error)
  })

  it('wraps native Error as InternalError with cause', () => {
    const original = new TypeError('bad type')
    const wrapped = wrapError(original)
    expect(wrapped).toBeInstanceOf(InternalError)
    expect(wrapped.code).toBe('WORKKIT_INTERNAL')
    expect(wrapped.message).toBe('bad type')
    expect(wrapped.cause).toBe(original)
  })

  it('wraps native Error with custom message', () => {
    const original = new TypeError('bad type')
    const wrapped = wrapError(original, 'Custom context')
    expect(wrapped.message).toBe('Custom context')
    expect(wrapped.cause).toBe(original)
  })

  it('wraps string as InternalError', () => {
    const wrapped = wrapError('string error')
    expect(wrapped).toBeInstanceOf(InternalError)
    expect(wrapped.message).toBe('string error')
  })

  it('wraps null/undefined', () => {
    expect(wrapError(null).message).toBe('null')
    expect(wrapError(undefined).message).toBe('undefined')
  })
})
