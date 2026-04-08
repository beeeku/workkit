---
"@workkit/ai-gateway": patch
---

- `CacheStorage` interface now includes a `delete` method (required for correct
  cache invalidation).
- `withCache().invalidate()` now calls `storage.delete()` instead of writing
  an empty string with a 1-second TTL, which could leave stale data visible
  for up to a second.
