# @workkit/approval

## 0.1.3

### Patch Changes

- Updated dependencies [b26dbbc]
  - @workkit/errors@1.0.4

## 0.1.2

### Patch Changes

- 2f2665e: **Declare `@workkit/types` as a runtime dependency.** These packages re-exported types from `@workkit/types` in their public API surface (`.d.ts`) but only listed the dependency in `devDependencies`. Consumers installing a single package without pulling the whole `@workkit/*` tree would see TypeScript "cannot find module" errors on `TypedDurableObjectStorage`, `MaybePromise`, `ExecutionContext`, and `ScheduledEvent`. Moved to `dependencies` so the types resolve transitively.

  No runtime behavior change — the imports are `import type` only.

## 0.1.1

### Patch Changes

- Updated dependencies [2e8d7f1]
  - @workkit/errors@1.0.3
