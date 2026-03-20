import { describe, it, expect } from 'vitest'
import { hash, hmac } from '../src/index'

describe('hash', () => {
  it('produces a hex string for SHA-256', async () => {
    const result = await hash('SHA-256', 'hello')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^[0-9a-f]+$/)
  })

  it('SHA-256 produces correct length (64 hex chars)', async () => {
    const result = await hash('SHA-256', 'test')
    expect(result.length).toBe(64)
  })

  it('SHA-512 produces correct length (128 hex chars)', async () => {
    const result = await hash('SHA-512', 'test')
    expect(result.length).toBe(128)
  })

  it('SHA-256 produces known value', async () => {
    // SHA-256 of empty string
    const result = await hash('SHA-256', '')
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('SHA-256 of "hello" matches known value', async () => {
    const result = await hash('SHA-256', 'hello')
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('same input produces same hash', async () => {
    const h1 = await hash('SHA-256', 'data')
    const h2 = await hash('SHA-256', 'data')
    expect(h1).toBe(h2)
  })

  it('different input produces different hash', async () => {
    const h1 = await hash('SHA-256', 'data1')
    const h2 = await hash('SHA-256', 'data2')
    expect(h1).not.toBe(h2)
  })

  it('supports SHA-1', async () => {
    const result = await hash('SHA-1', 'test')
    expect(result.length).toBe(40)
  })

  it('supports SHA-384', async () => {
    const result = await hash('SHA-384', 'test')
    expect(result.length).toBe(96)
  })
})

describe('hmac', () => {
  it('produces a hex string', async () => {
    const result = await hmac('secret', 'data')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^[0-9a-f]+$/)
  })

  it('produces SHA-256 length output (64 hex chars)', async () => {
    const result = await hmac('secret', 'data')
    expect(result.length).toBe(64)
  })

  it('same key + data produces same MAC', async () => {
    const m1 = await hmac('key', 'data')
    const m2 = await hmac('key', 'data')
    expect(m1).toBe(m2)
  })

  it('different key produces different MAC', async () => {
    const m1 = await hmac('key1', 'data')
    const m2 = await hmac('key2', 'data')
    expect(m1).not.toBe(m2)
  })

  it('different data produces different MAC', async () => {
    const m1 = await hmac('key', 'data1')
    const m2 = await hmac('key', 'data2')
    expect(m1).not.toBe(m2)
  })

  it('verify returns true for valid MAC', async () => {
    const mac = await hmac('secret', 'message')
    const valid = await hmac.verify('secret', 'message', mac)
    expect(valid).toBe(true)
  })

  it('verify returns false for wrong MAC', async () => {
    const valid = await hmac.verify('secret', 'message', 'deadbeef'.repeat(8))
    expect(valid).toBe(false)
  })

  it('verify returns false for wrong key', async () => {
    const mac = await hmac('secret1', 'message')
    const valid = await hmac.verify('secret2', 'message', mac)
    expect(valid).toBe(false)
  })

  it('verify returns false for wrong data', async () => {
    const mac = await hmac('secret', 'message1')
    const valid = await hmac.verify('secret', 'message2', mac)
    expect(valid).toBe(false)
  })

  it('verify returns false for different length MAC', async () => {
    const valid = await hmac.verify('secret', 'message', 'short')
    expect(valid).toBe(false)
  })

  it('verify returns false for empty MAC', async () => {
    const valid = await hmac.verify('secret', 'message', '')
    expect(valid).toBe(false)
  })

  it('rejects empty key (Web Crypto constraint)', async () => {
    await expect(hmac('', 'data')).rejects.toThrow()
  })

  it('handles unicode in key and data', async () => {
    const mac = await hmac('秘密', 'メッセージ 🔐')
    expect(typeof mac).toBe('string')
    const valid = await hmac.verify('秘密', 'メッセージ 🔐', mac)
    expect(valid).toBe(true)
  })
})

describe('hash edge cases', () => {
  it('hashes unicode strings', async () => {
    const result = await hash('SHA-256', '日本語テスト')
    expect(result.length).toBe(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })

  it('hashes very long strings', async () => {
    const result = await hash('SHA-256', 'x'.repeat(1_000_000))
    expect(result.length).toBe(64)
  })

  it('hashes string with newlines and tabs', async () => {
    const result = await hash('SHA-256', 'line1\nline2\ttab')
    expect(result.length).toBe(64)
  })
})
