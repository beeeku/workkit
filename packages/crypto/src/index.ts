// Encryption
export { encrypt, decrypt, encryptWithAAD, decryptWithAAD } from "./encrypt";

// Key management
export { generateKey, exportKey, importKey } from "./keys";

// Key derivation (also available via '@workkit/crypto/derive')
export { deriveKey } from "./derive";

// Envelope encryption
export { envelope } from "./envelope";

// Hashing
export { hash, hmac } from "./hash";

// Random utilities
export { randomBytes, randomHex, randomUUID } from "./random";

// Types
export type { HashAlgorithm, SealedEnvelope, HmacFn } from "./types";
