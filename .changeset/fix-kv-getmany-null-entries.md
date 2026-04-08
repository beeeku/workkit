---
"@workkit/kv": patch
---

`getMany` now includes missing keys in the returned `Map` with a `null` value
instead of omitting them entirely.  This lets callers distinguish between
"key was not requested" and "key does not exist in KV".
