---
"@workkit/r2": minor
---

**Security fix**: `createPresignedUrl` now requires a `signingSecret` parameter.

Previously the HMAC key was derived from the public URL payload itself, making
the signature trivially forgeable by any caller who could read the URL.  The
signing secret must now be provided by the caller and kept server-side; the
verifying Worker route must use the same secret.

```ts
// Before (insecure — key was derived from the public payload)
await createPresignedUrl(env.BUCKET, { key, method: "GET" });

// After
await createPresignedUrl(env.BUCKET, {
  key,
  method: "GET",
  signingSecret: env.PRESIGN_SECRET,
});
```
