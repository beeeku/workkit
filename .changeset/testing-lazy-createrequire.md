---
"@workkit/testing": patch
---

**Defer `createRequire()` until `openAdapter()` is called.** Previously `createRequire(import.meta.url)` ran at module-init time in `src/adapter.ts`, so merely importing `@workkit/testing` would throw in runtimes without `node:module` (e.g. workerd). Same class of fix as the agent createRequire issue (#64).

The adapter itself still only works under Bun or Node ≥22 — but the import is now side-effect-free.
