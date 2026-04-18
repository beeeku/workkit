---
"@workkit/do": patch
"@workkit/mcp": patch
"@workkit/api": patch
"@workkit/cron": patch
"@workkit/approval": patch
---

**Declare `@workkit/types` as a runtime dependency.** These packages re-exported types from `@workkit/types` in their public API surface (`.d.ts`) but only listed the dependency in `devDependencies`. Consumers installing a single package without pulling the whole `@workkit/*` tree would see TypeScript "cannot find module" errors on `TypedDurableObjectStorage`, `MaybePromise`, `ExecutionContext`, and `ScheduledEvent`. Moved to `dependencies` so the types resolve transitively.

No runtime behavior change — the imports are `import type` only.
