import { describe, it, expect } from 'vitest'
import { prefixKey, stripPrefix, validateKey } from '../src/utils'
import { ValidationError } from '@workkit/errors'

describe('prefixKey', () => {
  it('prepends prefix to key', () => {
    expect(prefixKey('user:', '123')).toBe('user:123')
  })

  it('returns key unchanged when prefix is undefined', () => {
    expect(prefixKey(undefined, '123')).toBe('123')
  })

  it('returns key unchanged when prefix is empty string', () => {
    expect(prefixKey('', '123')).toBe('123')
  })
})

describe('stripPrefix', () => {
  it('strips prefix from key', () => {
    expect(stripPrefix('user:', 'user:123')).toBe('123')
  })

  it('returns key unchanged when prefix is undefined', () => {
    expect(stripPrefix(undefined, 'user:123')).toBe('user:123')
  })

  it('returns key unchanged when key does not start with prefix', () => {
    expect(stripPrefix('user:', 'post:123')).toBe('post:123')
  })
})

describe('validateKey', () => {
  it('passes for valid key', () => {
    expect(() => validateKey('some-key')).not.toThrow()
  })

  it('throws ValidationError for empty string', () => {
    expect(() => validateKey('')).toThrow(ValidationError)
  })

  it('throws ValidationError for key exceeding 512 bytes', () => {
    const longKey = 'a'.repeat(513)
    expect(() => validateKey(longKey)).toThrow(ValidationError)
    expect(() => validateKey(longKey)).toThrow(/512 bytes/)
  })

  it('counts bytes correctly for multi-byte characters', () => {
    // Each emoji is 4 bytes, 128 emojis = 512 bytes = OK
    const maxKey = '🔑'.repeat(128)
    expect(() => validateKey(maxKey)).not.toThrow()

    // 129 emojis = 516 bytes = too long
    const tooLong = '🔑'.repeat(129)
    expect(() => validateKey(tooLong)).toThrow(ValidationError)
  })
})
