# @workkit/crypto

> AES-256-GCM encryption, key derivation, hashing, and random utilities for Workers

[![npm](https://img.shields.io/npm/v/@workkit/crypto)](https://www.npmjs.com/package/@workkit/crypto)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/crypto)](https://bundlephobia.com/package/@workkit/crypto)

## Install

```bash
bun add @workkit/crypto
```

## Usage

### Before (raw WebCrypto)

```ts
// 20+ lines just to encrypt a value
const iv = crypto.getRandomValues(new Uint8Array(12))
const keyMaterial = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  "PBKDF2",
  false,
  ["deriveKey"],
)
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
  keyMaterial,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"],
)
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
// ... concatenate IV, base64 encode, etc.
```

### After (workkit crypto)

```ts
import { deriveKey, encrypt, decrypt, hash, hmac, randomHex } from "@workkit/crypto"

// Encrypt/decrypt in one line
const key = await deriveKey(secret, salt)
const token = await encrypt(key, { userId: "123", role: "admin" })
const data = await decrypt(key, token) // { userId: "123", role: "admin" }

// Hashing
const digest = await hash("SHA-256", "hello world") // hex string
const signature = await hmac("SHA-256", secret, payload) // HMAC hex

// Random values
const hex = randomHex(32) // 64-char hex string
const id = randomUUID() // crypto.randomUUID()
```

## API

### Encryption

- **`encrypt(key, data)`** — AES-256-GCM encrypt. Accepts strings or JSON-serializable values. Returns base64.
- **`decrypt(key, ciphertext)`** — Decrypt. Auto-parses JSON if applicable.

### Key Management

- **`generateKey()`** — Generate a new AES-GCM CryptoKey
- **`deriveKey(secret, salt)`** — Derive a key from a password using PBKDF2
- **`exportKey(key)`** — Export a CryptoKey to base64
- **`importKey(base64)`** — Import a CryptoKey from base64

### Hashing

- **`hash(algorithm, data)`** — SHA-256/384/512 hash, returns hex
- **`hmac(algorithm, key, data)`** — HMAC signature, returns hex

### Random

- **`randomBytes(length)`** — Cryptographically random `Uint8Array`
- **`randomHex(length)`** — Random hex string
- **`randomUUID()`** — UUID v4

## License

MIT
