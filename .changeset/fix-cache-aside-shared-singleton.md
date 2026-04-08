---
"@workkit/cache": patch
---

`cacheAside`: each call now creates its own isolated in-memory cache when no
explicit `cache` instance is provided, preventing unintended key-space
collisions between unrelated `cacheAside` wrappers that previously shared a
single module-level cache.
