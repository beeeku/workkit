# Workkit Monorepo Audit Report

**Date**: 2026-03-20
**Scope**: Dead code, dependencies, bundle size, performance
**Tool**: knip, bun outdated, manual analysis

---

## 1. Dead Code / Unused Exports (knip)

### Unused Dependencies (8)

| Package | Unused Dependency | Action |
|---------|------------------|--------|
| `@workkit/cache` | `@workkit/types`, `@workkit/errors` | **Remove** — not imported in source |
| `@workkit/crypto` | `@workkit/types`, `@workkit/errors` | **Remove** — not imported in source |
| `@workkit/cli` | `@workkit/types`, `@workkit/errors`, `@workkit/env`, `@workkit/d1` | **Move to devDependencies** — only referenced inside template strings for code generation, not runtime imports |

**Impact: HIGH** — Reduces install size and clarifies the actual dependency graph.

### Unused devDependencies (18)

| Dependency | Scope | Action |
|-----------|-------|--------|
| `expect-type` | 17 packages | **Remove from all** — not used in any test file |
| `@cloudflare/workers-types` | root `package.json` | **Remove from root** — already in every package |
| `bunup` | root `package.json` | **Remove from root** — already in every package |
| `@workkit/types` | `@workkit/errors` devDeps | **Remove** — if not used in tests (verify) |
| `@standard-schema/spec` | `@workkit/types` devDeps | **Remove** — not used |

**Impact: MEDIUM** — Cleaner lockfile, faster installs.

### Unused Exports (6 values, 7 types)

**Value exports:**
- `packages/cli/src/utils.ts`: `red`, `green`, `yellow`, `blue`, `warn` — CLI color helpers defined but never used
- `packages/r2/tests/helpers/mock-r2.ts`: `bufferToStream` — test helper never called

**Type exports (lower priority):**
- `packages/ai/src/types.ts`: `ModelInputMap`, `ModelOutputMap` — designed for future type inference, keep if planned
- `packages/api/src/types.ts`: `ClientMethods` — unused type alias
- `packages/do/src/types.ts`: `MinimalDONamespace`, `MinimalDOId`, `MinimalDOStub` — compatibility interfaces, likely intended for consumers
- `packages/d1/tests/helpers/mock-d1.ts`: `MockD1Meta` — test helper type

**Recommendation**: Remove `cli/utils.ts` color exports (dead code). Keep DO minimal interfaces (public API). Evaluate AI model maps based on roadmap.

### Unlisted Dependencies (2)

| Package | Missing From | Used In |
|---------|-------------|---------|
| `@standard-schema/spec` | `@workkit/astro` | `tests/helpers.ts` — add to devDeps |
| `zod` | `@workkit/hono` | `tests/middleware.test.ts` — add to devDeps |

**Impact: HIGH** — These will break in CI with clean installs. Currently work only because hoisted from other packages.

### Unused Files (40)

Knip flags all `bunup.config.ts` files (21), all e2e tests (10), all examples (8), and `packages/env/src/validators/index.ts` as unused. These are **false positives** from missing knip configuration. A `knip.json` should be added (see recommendation below).

---

## 2. Dependency Audit

### Version Conflicts

| Dependency | Conflict | Action |
|-----------|---------|--------|
| `zod` | `@workkit/api` uses `^3.24.0`, `@workkit/env` uses `^4.3.6` | **Align to zod v4** — zod v3 and v4 have different APIs. If api only uses zod in tests, update to v4. |
| `@standard-schema/spec` | `@workkit/remix` has `^1.1.0` as runtime dep, others have `^1.0.0` as devDep | **Make peer dep** in remix — it's only used via `import type`, so it should be a peerDep or devDep, not a runtime dependency |

**Impact: HIGH for zod** — Having both zod v3 and v4 in the tree wastes ~200KB and creates confusion.

### Hoisting Opportunities

These devDependencies are identical across 17-21 packages and should be hoisted to the root `package.json` only:

| Dependency | Count | Version |
|-----------|-------|---------|
| `@cloudflare/workers-types` | 20 packages | `^4.20250310.0` |
| `bunup` | 21 packages | `0.16.31` |
| `typescript` | 21 packages | `^5.7.0` |
| `vitest` | 21 packages | `^3.0.0` |
| `expect-type` | 17 packages (unused) | `^1.1.0` |

**Impact: MEDIUM** — Dramatically simplifies package.json files. With bun workspaces, devDeps in root are available to all packages. Reduces lockfile churn on version bumps (change 1 file instead of 21).

### Outdated Dependencies

| Dependency | Current | Latest | Notes |
|-----------|---------|--------|-------|
| `@biomejs/biome` | 1.9.4 | 2.4.8 | **Major upgrade** — Biome 2.x has breaking config changes. Plan migration. |
| `vitest` | 3.2.4 | 4.1.0 | **Major upgrade** — Test before upgrading. |

### Missing Dependency: `@standard-schema/spec` as peerDep

`@workkit/env` correctly declares `@standard-schema/spec` as a peerDep. But `@workkit/remix` declares it as a runtime dependency despite using only `import type`. This should be a peerDep to match env's pattern.

---

## 3. Bundle Size Analysis

### Dist Sizes (code only, excluding sourcemaps)

| Package | Code Size | Sourcemap Size | Total | Assessment |
|---------|-----------|---------------|-------|------------|
| `testing` | 272K | 280K | 552K | **Oversized** |
| `api` | 92K | 64K | 156K | Normal |
| `d1` | 92K | 76K | 168K | Normal |
| `cli` | 80K | 76K | 156K | Normal |
| `crypto` | 68K | 52K | 120K | Normal |
| `r2` | 60K | 36K | 96K | Normal |
| `ai-gateway` | 56K | 36K | 92K | Normal |
| `ai` | 56K | 24K | 80K | Normal |
| All others | 32-48K | 12-32K | 44-80K | Normal |

### Key Findings

1. **`@workkit/testing` at 552K is 3-7x larger than other packages.** Root cause: 9 entry points, each bundled as both ESM and CJS, with the CJS output inlining shared code. The D1 mock alone produces 17K CJS. The env mock produces 30K CJS. This is acceptable for a devDependency but could be optimized.

2. **Source maps account for 860K across all packages.** These are shipped with `"sourcemap": "linked"` in all bunup configs. For a library consumed by Workers, sourcemaps are useful. No action needed unless npm package size becomes a concern.

3. **CJS output is unnecessary.** All packages declare `"type": "module"`. Cloudflare Workers are ESM-only. CJS output roughly doubles dist size across the board. The only consumer that might need CJS would be older Node.js test setups, which is increasingly rare.

**Impact: HIGH** — Dropping CJS output would cut total dist size roughly in half (~1MB saved across all packages).

---

## 4. Performance Improvements

### Build Performance

**Current**: 42 tasks, ~22s total (with 4 cached), turbo handles parallelization.

**Issue 1: `test` depends on `build`**
```json
"test": { "dependsOn": ["build"] }
```
Tests import from `../src/` (relative paths), not from built `dist/`. This `dependsOn` is unnecessary and forces a full build before any test run. Removing it would allow tests to run in parallel with builds.

**Recommendation**: Remove `"dependsOn": ["build"]` from the test task. Tests use vitest which handles TypeScript directly.

**Issue 2: No `outputs` for `typecheck` and `lint`**
These tasks produce no output files but also have no `outputs: []` declaration, meaning turbo cannot cache them effectively.

**Recommendation**: Add `"outputs": []` to `typecheck` and `lint` tasks for proper caching.

### Test Performance

**Total**: ~22s for 42 tasks (21 build + 21 test). Actual test execution is fast (most suites run in <100ms). The overhead is vitest startup per package (~2-5s each).

**Observation**: The `@workkit/testing` package has 5.28s duration but only 216ms of actual test time. The rest is transform (1.77s) and collect (3.96s) — vitest startup overhead. This pattern is consistent across all packages.

**Recommendation**: Consider a single vitest workspace config at the root to run all tests in one vitest process. This eliminates 20 redundant vitest cold starts. Potential savings: 30-50% of total test time.

### Code Patterns

1. **Async where sync suffices**: `packages/env/src/parse.ts` correctly provides both `parseEnv` (async) and `parseEnvSync` (sync). Standard Schema validators are sync in practice (zod, valibot, arktype all return sync). The async version adds `Promise.all` overhead for a typically-sync operation. The codebase handles this well by offering both.

2. **No circular dependencies**: Clean dependency graph. All internal deps flow downward to `@workkit/types` and `@workkit/errors`.

3. **Consistent patterns**: All packages follow the same structure (src/, tests/, bunup.config.ts, vitest.config.ts). This is good for maintainability.

4. **`node_modules` at 254MB**: Normal for a monorepo with TypeScript, vitest, and Cloudflare types.

---

## 5. Recommended knip Configuration

Create `knip.json` at the project root to eliminate false positives:

```json
{
  "workspaces": {
    ".": {
      "entry": ["e2e/**/*.test.ts", "examples/*/src/index.ts"],
      "ignoreDependencies": ["@cloudflare/workers-types", "bunup"]
    },
    "packages/*": {
      "entry": ["src/index.ts", "src/*.ts"],
      "project": ["src/**/*.ts", "tests/**/*.ts"],
      "ignoreDependencies": ["bunup"]
    },
    "packages/env": {
      "entry": ["src/index.ts", "src/validators/index.ts"],
      "project": ["src/**/*.ts", "tests/**/*.ts"]
    },
    "integrations/*": {
      "entry": ["src/index.ts"],
      "project": ["src/**/*.ts", "tests/**/*.ts"],
      "ignoreDependencies": ["bunup"]
    }
  },
  "ignore": ["**/bunup.config.ts"]
}
```

---

## 6. Prioritized Action Items

### P0 — Fix Before Release

1. **Add unlisted dependencies** — `@standard-schema/spec` to `@workkit/astro` devDeps, `zod` to `@workkit/hono` devDeps. These cause broken installs.
2. **Align zod versions** — Standardize on zod v4 across the monorepo (api and env packages).
3. **Remove unused runtime deps** from `@workkit/cache` and `@workkit/crypto` — they falsely inflate the dependency graph for consumers.

### P1 — High Impact Improvements

4. **Drop CJS output** — All packages are ESM, all consumers (Cloudflare Workers) are ESM. Saves ~50% of dist size.
5. **Hoist shared devDependencies** — Move `typescript`, `vitest`, `@cloudflare/workers-types`, `bunup` to root only. Simplifies 21 package.json files.
6. **Remove `test` dependsOn `build`** in turbo.json — Tests don't use built output. Decoupling speeds up `turbo test` by eliminating unnecessary build steps.
7. **Move `@standard-schema/spec` from deps to peerDeps** in `@workkit/remix` — It's a type-only import.
8. **Remove `expect-type`** from all 17 packages — Entirely unused.

### P2 — Nice to Have

9. **Add knip.json** — Enables ongoing dead code detection in CI.
10. **Add `"outputs": []`** to `typecheck` and `lint` turbo tasks for proper caching.
11. **Remove dead CLI color exports** (`red`, `green`, `yellow`, `blue`, `warn` in `packages/cli/src/utils.ts`).
12. **Consider vitest workspace mode** — Single vitest process for all packages, eliminating cold start overhead.
13. **Plan Biome 2.x migration** — Current 1.9.4 is two major versions behind.
14. **Move CLI template dependencies to devDeps** — `@workkit/env`, `@workkit/d1`, etc. in cli are only used inside string templates for code generation.

### P3 — Future Consideration

15. **Evaluate unused type exports** — `ModelInputMap`/`ModelOutputMap` in ai, `ClientMethods` in api, `MinimalDO*` in do. Keep if planned for public API, remove if not.
16. **Vitest 4.x upgrade** — Test in a branch first, check for breaking changes.
