---
"@workkit/memory": minor
---

Wire `encryptionKey` so `metadata.encrypted: true` actually encrypts fact text at rest.

Previously the `encryptionKey` option was accepted on `createMemory()` but ignored — facts marked `encrypted: true` were stored as plaintext. The `text` column is now AES-256-GCM encrypted on insert (12-byte IV prefix, base64-encoded) when both the key and `encrypted: true` are present, and transparently decrypted on `get()`, `recall()`, and `search()`.

Calling `remember(text, { encrypted: true })` without `createMemory({ encryptionKey })` now returns `{ ok: false, error: { code: "ENCRYPTION_ERROR" } }` instead of silently storing plaintext.
