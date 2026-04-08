---
"@workkit/ratelimit": patch
---

`fixedWindow` and `slidingWindow`: denied requests no longer write an inflated
counter back to KV.  Previously every denied request incremented and persisted
the counter, causing the reported `remaining` value to diverge from reality and
generating unnecessary KV write operations.
