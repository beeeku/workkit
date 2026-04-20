---
"@workkit/ratelimit": patch
---

**Clamp KV `expirationTtl` to ≥ 60s on all writes.** Cloudflare KV rejects any `expirationTtl` below 60 with `400 Invalid expiration_ttl`. Previously `fixedWindow`, `slidingWindow`, and `quota` wrote TTLs as low as 1s — breaking `wrangler dev` in the last ~minute of any window and violating the documented KV contract. The counter lives slightly past the logical window end, but each entry carries its own `windowStart`, so a stale read is reinterpreted correctly by the next write.

Closes #108.
