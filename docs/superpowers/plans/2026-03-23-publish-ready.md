# Workkit Publish-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CI failures, packaging bugs, test failures, and documentation issues to make workkit fully publish-ready on npm.

**Architecture:** Six independent tasks that can be parallelized in groups. Task 1 (lockfile) unblocks CI. Task 2 (CLI bundling) fixes the published CLI. Task 3 (e2e test) fixes the SWR stale test. Task 4 (doc URLs) updates outdated references. Task 5 (branch cleanup) removes 6 merged branches. Task 6 (dry-run publish) validates everything works end-to-end.

**Tech Stack:** Bun 1.3.8, bunup, changesets, vitest, GitHub Actions

---

### Task 1: Fix CI — Regenerate Lockfile

**Files:**
- Modify: `bun.lock`

The CI (`ci.yml` and `release.yml`) runs `bun install --frozen-lockfile` which fails because `bun.lock` is stale (deps were changed without regenerating it).

- [ ] **Step 1: Regenerate lockfile**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun install`

This resolves all `workspace:*` references and updates `bun.lock`.

- [ ] **Step 2: Verify frozen-lockfile works**

Run: `bun install --frozen-lockfile`
Expected: exits 0 with no "lockfile had changes" error.

- [ ] **Step 3: Commit**

```bash
git add bun.lock
git commit -m "fix: regenerate lockfile for CI frozen-lockfile check"
```

---

### Task 2: Fix CLI Packaging — Bundle Internal Deps

**Files:**
- Modify: `packages/cli/bunup.config.ts`
- Modify: `packages/cli/package.json`

The CLI was published with `workspace:*` deps (`@workkit/types`, `@workkit/errors`, `@workkit/env`, `@workkit/d1`). These are listed in `devDependencies` and marked `external` in `bunup.config.ts`, so they're not bundled into the dist. When a user runs `npx workkit`, npm fails with `EUNSUPPORTEDPROTOCOL` because it can't resolve `workspace:*`.

**Fix:** Remove the `external` array so bunup bundles these deps into the CLI binary. Move `@workkit/*` out of `devDependencies` since they'll be inlined. The CLI is a standalone binary — bundling is the correct approach.

- [ ] **Step 1: Remove external array from bunup config**

In `packages/cli/bunup.config.ts`, remove line 8:
```ts
external: ["@workkit/types", "@workkit/errors", "@workkit/env", "@workkit/d1"],
```

The file should become:
```ts
import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	banner: "#!/usr/bin/env node",
});
```

- [ ] **Step 2: Remove @workkit/* from devDependencies**

In `packages/cli/package.json`, remove the 4 `@workkit/*` entries from `devDependencies`:
```json
"devDependencies": {
    "@types/node": "^25.5.0"
}
```

- [ ] **Step 3: Build and verify CLI works**

Run:
```bash
cd /Users/Bikash/.instar/agents/jarvis/workkit
bun run build --filter=workkit
node packages/cli/dist/index.js --help
```
Expected: CLI help output without import errors.

- [ ] **Step 4: Run CLI tests**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun run test --filter=workkit`
Expected: All CLI tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/bunup.config.ts packages/cli/package.json
git commit -m "fix(cli): bundle internal deps instead of marking external

workspace:* deps can't be resolved by npm outside the monorepo.
Bundling them into the CLI binary makes npx workkit work correctly."
```

---

### Task 3: Fix E2E SWR Test

**Files:**
- Modify: `e2e/cache-flow.test.ts` (lines 45-73)

The test "returns stale data and revalidates in background" fails because it stores the cache entry with `ttl: 0`, which causes the memory cache's `get()` to treat it as expired and return `undefined`. The SWR function then falls through to the cache-miss branch and returns `{stale: false}`.

**Root cause:** `cache.put('/stale-key', response, { ttl: 0 })` → `expiresAt = now + 0*1000 = now` → `Date.now() > expiresAt` is true on the next tick → `get()` returns `undefined`.

**Fix:** Use a high TTL for the cache entry (so it physically survives in the cache) and rely on the metadata timestamp to signal staleness. The SWR implementation checks staleness via `__swr_meta__` timestamps, not cache TTL.

- [ ] **Step 1: Fix the test TTL**

In `e2e/cache-flow.test.ts`, change line 51 from:
```ts
await cache.put('/stale-key', response, { ttl: 0 }) // immediate expiry TTL=0
```
to:
```ts
await cache.put('/stale-key', response, { ttl: 99999 }) // keep in cache; staleness is determined by metadata
```

- [ ] **Step 2: Run the e2e test**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun vitest run e2e/cache-flow.test.ts`
Expected: All tests pass, including "returns stale data and revalidates in background".

- [ ] **Step 3: Run all e2e tests**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun run test:e2e`
Expected: All 245 e2e tests pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/cache-flow.test.ts
git commit -m "fix(e2e): use valid TTL in SWR stale test

TTL=0 caused the memory cache to expire the entry before SWR could
read it. The test now keeps the entry alive with a high TTL and relies
on metadata timestamps to signal staleness, matching how SWR works."
```

---

### Task 4: Update Documentation URLs

**Files:**
- Modify: `docs/superpowers/plans/2026-03-21-website-phase1.md` (3 occurrences of `workkit.bika.sh`)

The plan doc still references `workkit.bika.sh` (Cloudflare Pages). The site is now deployed to GitHub Pages at `https://beeeku.github.io/workkit/`.

Note: `astro.config.mjs`, `Landing.tsx`, all `package.json` files, and all README files already have correct URLs.

- [ ] **Step 1: Update URLs in website plan doc**

Replace all occurrences of `workkit.bika.sh` with `beeeku.github.io/workkit` in `docs/superpowers/plans/2026-03-21-website-phase1.md`:
- Line 5: `site: 'https://workkit.bika.sh'` → `site: 'https://beeeku.github.io'`
- Line 150: same pattern
- Line 652: "Ready for deployment to workkit.bika.sh via Cloudflare Pages" → "Deployed to beeeku.github.io/workkit via GitHub Pages"

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-03-21-website-phase1.md
git commit -m "docs: update URLs from workkit.bika.sh to GitHub Pages"
```

---

### Task 5: Clean Up Stale Branches

**Files:** None (git operations only)

6 merged branches exist locally and on remote:
- `docs/add-cli-readme`
- `feat/website-phase1`
- `feat/website-spec`
- `fix/drop-cjs-fix-turbo`
- `fix/hoist-devdeps-cleanup`
- `fix/p0-dependency-cleanup`

- [ ] **Step 1: Delete local branches**

```bash
git branch -d docs/add-cli-readme feat/website-phase1 feat/website-spec fix/drop-cjs-fix-turbo fix/hoist-devdeps-cleanup fix/p0-dependency-cleanup
```

- [ ] **Step 2: Delete remote branches**

```bash
git push origin --delete docs/add-cli-readme feat/website-phase1 feat/website-spec fix/drop-cjs-fix-turbo fix/hoist-devdeps-cleanup fix/p0-dependency-cleanup
```

---

### Task 6: Validate Publish — Dry Run

**Files:** None (validation only)

Run changeset publish in dry-run mode to verify all packages can be published to npm.

- [ ] **Step 1: Build all packages**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun run build`
Expected: All 22 packages build successfully.

- [ ] **Step 2: Run all tests**

Run: `bun run test`
Expected: All 2,456+ tests pass.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: Clean typecheck across all packages.

- [ ] **Step 4: Dry-run publish each package**

Run from each package directory:
```bash
for pkg in packages/*/; do
  name=$(cd "$pkg" && node -p "require('./package.json').name")
  echo "=== $name ==="
  (cd "$pkg" && npm publish --dry-run 2>&1) || true
  echo ""
done

for pkg in integrations/*/; do
  name=$(cd "$pkg" && node -p "require('./package.json').name")
  echo "=== $name ==="
  (cd "$pkg" && npm publish --dry-run 2>&1) || true
  echo ""
done
```

Expected: Each package reports what it WOULD publish — no `workspace:*` references in any dependency listing, correct `dist/` files included. Verify especially that the `workkit` CLI package has NO `@workkit/*` dependencies listed.

- [ ] **Step 5: Verify CLI binary in dry-run output**

In the CLI dry-run output, confirm:
- `bin` field points to `dist/index.js`
- No `@workkit/*` in dependencies (they should be bundled)
- `dist/index.js` contains the bundled code (not import references)

- [ ] **Step 6: Push all commits and verify CI passes**

```bash
git push origin master
```

Monitor CI at: `gh run list --limit 3`
Expected: CI workflow (lint, typecheck, test, bundle-size) passes. Release workflow passes.
