import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, generateKey, exportKey, importKey, deriveKey } from '@workkit/crypto'
import { envelope } from '@workkit/crypto/envelope'
import { createMockKV } from './helpers/setup'
import { kv } from '@workkit/kv'

describe('Crypto cross-package flow', () => {
  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts a string', async () => {
      const key = await generateKey()
      const ciphertext = await encrypt(key, 'Hello, World!')
      const plaintext = await decrypt(key, ciphertext)
      expect(plaintext).toBe('Hello, World!')
    })

    it('encrypts and decrypts JSON data', async () => {
      const key = await generateKey()
      const data = { userId: '123', role: 'admin', permissions: ['read', 'write'] }
      const ciphertext = await encrypt(key, data)
      const plaintext = await decrypt(key, ciphertext)
      expect(plaintext).toEqual(data)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', async () => {
      const key = await generateKey()
      const ct1 = await encrypt(key, 'same data')
      const ct2 = await encrypt(key, 'same data')
      expect(ct1).not.toBe(ct2)

      // But both decrypt to the same value
      expect(await decrypt(key, ct1)).toBe('same data')
      expect(await decrypt(key, ct2)).toBe('same data')
    })

    it('fails to decrypt with wrong key', async () => {
      const key1 = await generateKey()
      const key2 = await generateKey()
      const ciphertext = await encrypt(key1, 'secret')

      await expect(decrypt(key2, ciphertext)).rejects.toThrow()
    })

    it('fails to decrypt empty ciphertext', async () => {
      const key = await generateKey()
      await expect(decrypt(key, '')).rejects.toThrow()
    })

    it('handles empty string plaintext', async () => {
      const key = await generateKey()
      const ct = await encrypt(key, '')
      const pt = await decrypt(key, ct)
      expect(pt).toBe('')
    })

    it('handles nested objects', async () => {
      const key = await generateKey()
      const data = {
        user: { name: 'Alice', settings: { theme: 'dark', notifications: true } },
        metadata: [1, 2, 3],
      }
      const ct = await encrypt(key, data)
      const pt = await decrypt(key, ct)
      expect(pt).toEqual(data)
    })
  })

  describe('encrypt with KV storage', () => {
    it('encrypts data and stores in mock KV, then retrieves and decrypts', async () => {
      const key = await generateKey()
      const mockKV = createMockKV()
      const store = kv<string>(mockKV, { prefix: 'enc:' })

      const secret = { apiKey: 'sk-test-abc', endpoint: 'https://api.example.com' }
      const ciphertext = await encrypt(key, secret)

      // Store encrypted data in KV
      await store.put('config', ciphertext)

      // Retrieve and decrypt
      const retrieved = await store.get('config')
      expect(retrieved).not.toBeNull()

      const decrypted = await decrypt(key, retrieved!)
      expect(decrypted).toEqual(secret)
    })

    it('stores multiple encrypted values in KV', async () => {
      const key = await generateKey()
      const mockKV = createMockKV()
      const store = kv<string>(mockKV, { prefix: 'secrets:' })

      const secrets = {
        db_password: 'super-secret-123',
        api_key: 'sk-live-xyz',
        webhook_secret: 'whsec_abc',
      }

      for (const [name, value] of Object.entries(secrets)) {
        const ct = await encrypt(key, value)
        await store.put(name, ct)
      }

      // Retrieve and decrypt each
      for (const [name, expected] of Object.entries(secrets)) {
        const ct = await store.get(name)
        const pt = await decrypt(key, ct!)
        expect(pt).toBe(expected)
      }
    })
  })

  describe('envelope encryption for KV data at rest', () => {
    it('seals and opens data with envelope encryption', async () => {
      const masterKey = await generateKey()
      const data = { userId: '123', email: 'alice@example.com' }

      const sealed = await envelope.seal(masterKey, data)
      expect(sealed.encryptedData).toBeDefined()
      expect(sealed.encryptedKey).toBeDefined()

      const opened = await envelope.open(masterKey, sealed.encryptedKey, sealed.encryptedData)
      expect(opened).toEqual(data)
    })

    it('stores envelope-encrypted data in KV', async () => {
      const masterKey = await generateKey()
      const mockKV = createMockKV()

      const userData = { name: 'Alice', ssn: '123-45-6789' }
      const sealed = await envelope.seal(masterKey, userData)

      // Store both pieces in KV
      await mockKV.put('user:1:data', sealed.encryptedData)
      await mockKV.put('user:1:key', sealed.encryptedKey)

      // Retrieve and open
      const storedData = await mockKV.get('user:1:data')
      const storedKey = await mockKV.get('user:1:key')

      const opened = await envelope.open(masterKey, storedKey!, storedData!)
      expect(opened).toEqual(userData)
    })

    it('each seal uses a unique DEK', async () => {
      const masterKey = await generateKey()
      const data = 'same data'

      const sealed1 = await envelope.seal(masterKey, data)
      const sealed2 = await envelope.seal(masterKey, data)

      // Different DEKs produce different ciphertexts
      expect(sealed1.encryptedKey).not.toBe(sealed2.encryptedKey)

      // Both open to the same data
      const opened1 = await envelope.open(masterKey, sealed1.encryptedKey, sealed1.encryptedData)
      const opened2 = await envelope.open(masterKey, sealed2.encryptedKey, sealed2.encryptedData)
      expect(opened1).toBe(data)
      expect(opened2).toBe(data)
    })

    it('fails to open with wrong master key', async () => {
      const masterKey1 = await generateKey()
      const masterKey2 = await generateKey()
      const sealed = await envelope.seal(masterKey1, 'secret')

      await expect(
        envelope.open(masterKey2, sealed.encryptedKey, sealed.encryptedData),
      ).rejects.toThrow()
    })
  })

  describe('key derivation produces consistent results', () => {
    it('PBKDF2 derivation from password + salt', async () => {
      const key1 = await deriveKey('my-password', 'salt-123')
      const key2 = await deriveKey('my-password', 'salt-123')

      // Same inputs produce same key
      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).toBe(exported2)
    })

    it('different passwords produce different keys', async () => {
      const key1 = await deriveKey('password-a', 'same-salt')
      const key2 = await deriveKey('password-b', 'same-salt')

      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).not.toBe(exported2)
    })

    it('different salts produce different keys', async () => {
      const key1 = await deriveKey('same-password', 'salt-a')
      const key2 = await deriveKey('same-password', 'salt-b')

      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).not.toBe(exported2)
    })

    it('derived key can be used for encryption', async () => {
      const key = await deriveKey('user-password', 'user-123')
      const ct = await encrypt(key, { secret: 'data' })
      const pt = await decrypt(key, ct)
      expect(pt).toEqual({ secret: 'data' })
    })

    it('HKDF derivation from master key + context', async () => {
      const masterKey = await generateKey()
      const key1 = await deriveKey(masterKey, 'context-a')
      const key2 = await deriveKey(masterKey, 'context-a')

      // Same master key + context = same derived key
      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).toBe(exported2)
    })

    it('HKDF with different contexts produces different keys', async () => {
      const masterKey = await generateKey()
      const key1 = await deriveKey(masterKey, 'encryption')
      const key2 = await deriveKey(masterKey, 'signing')

      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).not.toBe(exported2)
    })
  })

  describe('key export/import roundtrip', () => {
    it('exports and imports a key', async () => {
      const original = await generateKey()
      const exported = await exportKey(original)

      expect(typeof exported).toBe('string')
      expect(exported.length).toBeGreaterThan(0)

      const imported = await importKey(exported)

      // Use both keys to verify they are equivalent
      const ct = await encrypt(original, 'test')
      const pt = await decrypt(imported, ct)
      expect(pt).toBe('test')
    })

    it('import fails with empty string', async () => {
      await expect(importKey('')).rejects.toThrow()
    })
  })
})
