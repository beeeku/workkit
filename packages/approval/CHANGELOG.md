# @workkit/approval

## 0.1.4

### Patch Changes

- 87f1092: chore(deps): raise runtime dependency floors to current in-range releases

  - `@workkit/approval`, `@workkit/mcp`: `hono` `^4.7.10` → `^4.13.11`
  - `@workkit/mail`: `mimetext` `^3.0.24` → `^3.0.28`, `postal-mime` `^2.4.1` → `^2.7.6`

  Same major versions; no API changes. The `hono` floor moves past the
  4.12.x advisories (CORS credential reflection, `bodyLimit` bypass, cache
  `Vary` leakage, `parseBody` nesting DoS, and others fixed through 4.13.5),
  so consumers resolving an older 4.x get a patched copy.

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
