import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, generateKey } from '../src/index'

describe('encrypt / decrypt', () => {
  it('round-trips a string', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, 'hello world')
    const plaintext = await decrypt(key, ciphertext)
    expect(plaintext).toBe('hello world')
  })

  it('round-trips an object via auto JSON serialization', async () => {
    const key = await generateKey()
    const obj = { userId: '123', role: 'admin' }
    const ciphertext = await encrypt(key, obj)
    const result = await decrypt(key, ciphertext)
    expect(result).toEqual(obj)
  })

  it('round-trips a number', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, 42)
    const result = await decrypt(key, ciphertext)
    expect(result).toBe(42)
  })

  it('round-trips a boolean', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, true)
    const result = await decrypt(key, ciphertext)
    expect(result).toBe(true)
  })

  it('round-trips null', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, null)
    const result = await decrypt(key, ciphertext)
    expect(result).toBeNull()
  })

  it('round-trips an array', async () => {
    const key = await generateKey()
    const arr = [1, 'two', { three: 3 }]
    const ciphertext = await encrypt(key, arr)
    const result = await decrypt(key, ciphertext)
    expect(result).toEqual(arr)
  })

  it('round-trips an empty string', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, '')
    const result = await decrypt(key, ciphertext)
    expect(result).toBe('')
  })

  it('produces a base64 string as ciphertext', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, 'test')
    expect(typeof ciphertext).toBe('string')
    // Should be valid base64
    expect(() => atob(ciphertext)).not.toThrow()
  })

  it('different keys produce different ciphertext', async () => {
    const key1 = await generateKey()
    const key2 = await generateKey()
    const ct1 = await encrypt(key1, 'same data')
    const ct2 = await encrypt(key2, 'same data')
    expect(ct1).not.toBe(ct2)
  })

  it('same key + same plaintext produces different ciphertext (random IV)', async () => {
    const key = await generateKey()
    const ct1 = await encrypt(key, 'same data')
    const ct2 = await encrypt(key, 'same data')
    expect(ct1).not.toBe(ct2)
  })

  it('throws on decrypt with wrong key', async () => {
    const key1 = await generateKey()
    const key2 = await generateKey()
    const ciphertext = await encrypt(key1, 'secret')
    await expect(decrypt(key2, ciphertext)).rejects.toThrow()
  })

  it('throws on corrupted ciphertext', async () => {
    const key = await generateKey()
    const ciphertext = await encrypt(key, 'secret')
    // Corrupt the ciphertext by modifying a character
    const corrupted = ciphertext.slice(0, -2) + 'XX'
    await expect(decrypt(key, corrupted)).rejects.toThrow()
  })

  it('throws on empty ciphertext', async () => {
    const key = await generateKey()
    await expect(decrypt(key, '')).rejects.toThrow()
  })

  it('round-trips a large string', async () => {
    const key = await generateKey()
    const largeStr = 'x'.repeat(100_000)
    const ciphertext = await encrypt(key, largeStr)
    const result = await decrypt(key, ciphertext)
    expect(result).toBe(largeStr)
  })

  it('round-trips unicode strings', async () => {
    const key = await generateKey()
    const unicode = '🔐 encryption 日本語 ñ'
    const ciphertext = await encrypt(key, unicode)
    const result = await decrypt(key, ciphertext)
    expect(result).toBe(unicode)
  })
})
