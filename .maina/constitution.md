# Project Constitution

Non-negotiable rules. Injected into every AI call. Mechanical checks live in `scripts/constitution-check.ts` and run as a CI gate.

## Stack

- Runtime: Bun (NOT Node.js)
- Language: TypeScript strict mode
- Lint/Format: biome (indentStyle: tab, lineWidth: 100)
- Test: vitest (via `turbo test`)
- Build: bunup (per-package), turbo (orchestrator)
- Monorepo: yes (bun workspaces)
- Package manager: bun@1.3.8

## Architecture

- **Domain**: Cloudflare Workers utility toolkit (`@workkit/*`)
- **Workspaces**:
  - `packages/*` — core packages (one `src/index.ts` export each)
  - `integrations/*` — framework adapters (hono, astro, remix)
  - `apps/*` — documentation site (Astro + Starlight)
  - `tooling/*` — shared tsconfig
  - `examples/*` — example apps
- **Key patterns**: Standard Schema validation, typed bindings, normalized errors via `@workkit/errors`, branded IDs
- **Target platform**: Cloudflare Workers (uses `@cloudflare/workers-types`)

## The Nine Rules

These are the load-bearing constraints that make workkit composable. Mechanical enforcement runs in CI via `bun run constitution:check`. The same rules live in `CLAUDE.md` for AI assistant context.

### 1. Zero runtime overhead

Reject heavy deps without explicit justification. **Threshold: a new direct `dependencies` entry whose unpacked size exceeds 50 KB requires a justification line in the changeset.** Optional peer deps (`peerDependenciesMeta.optional: true`) are acceptable for adapter-local heavy deps (e.g., `@react-email/render`).

**Why**: workkit is a primitives toolkit; bloat compounds across consumers.

### 2. Standard Schema only for validation

Public exported functions accepting validation MUST type the parameter as a Standard Schema (`StandardSchemaV1<T>` or a generic that extends it). **Never hard-code `ZodType<T>` in a public signature.**

**Why**: callers should be free to use Zod, Valibot, ArkType, or any future Standard-Schema vendor without forking the package.

### 3. Every package wires `@workkit/testing`

`packages/*/package.json` should declare `@workkit/testing` in `devDependencies`. Tooling, examples, and packages that mark `"//constitution-allow": "no-testing reason=..."` in their `package.json` are exempt.

**Why**: a shared test surface keeps the developer experience consistent.

### 4. Single `src/index.ts` export per package

Each package exposes exactly one runtime entry: `dist/index.js`. Subpath exports (`exports["./email"]` etc.) are allowed when an adapter family clearly belongs to the same package — but each subpath corresponds to its own `src/<name>/index.ts`.

**Why**: a single entry keeps tree-shaking predictable and discovery simple.

### 5. No cross-package imports except declared peer deps

Any `from "@workkit/<other>"` in `packages/<self>/src/**/*.ts` requires `@workkit/<other>` in `packages/<self>/package.json`'s `dependencies` or `peerDependencies`.

**Why**: prevents implicit graph edges that surprise consumers at install time.

### 6. Changeset required on every public API change

Any modification to `packages/*/src/**/*.ts` requires a corresponding `.changeset/*.md` file in the same PR. Internal-only / `private: true` packages are exempt.

**Why**: changesets are the single source of truth for `npm publish` versioning.

### 7. No `console.log` in production code

`console.log` is forbidden in `packages/*/src/**`. `console.warn`/`console.error` allowed for genuine diagnostic emission. Use `@workkit/logger` for structured logs.

**Why**: stray `console.log` leaks PII to production logs.

### 8. Diff-only fixes

When fixing issues, change only the lines on the diff. Don't reformat the file, don't refactor adjacent code, don't add features beyond what the issue requires.

**Why**: reduces review surface, isolates regressions.

### 9. TDD always

Write tests first. Every implementation task should have a preceding test task. The `maina spec` and `maina plan` commands enforce this in the workflow phase.

**Why**: tests-after produces tests that match the bug, not the contract.

## Verification commands

- Lint: `biome check .`
- Typecheck: `turbo typecheck`
- Test: `turbo test`
- Build: `turbo build`
- Constitution: `bun run constitution:check`
- Diff-only: only report findings on changed lines

## Conventions

- GitHub Actions CI/CD
- Conventional commits (feat, fix, refactor, test, docs, chore, ci, perf)
- Changesets for versioning (`@changesets/cli`)
- Type checking enforced
- biome rules: `noExplicitAny` off, `noNonNullAssertion` off, `noParameterAssign` off

## Escape hatches

When a rule must be broken, add an inline marker so the bypass is grep-able and visible at review time:

- `// constitution-allow:cross-package reason="<why>"` — on the offending import line
- `"//constitution-allow": "no-testing reason=<why>"` — top-level field in `package.json` files
- `// constitution-allow:console-log reason="<why>"` — on the offending console call
- `// constitution-allow:zod-signature reason="<why>"` — on Zod-typed signatures (rare)

The CI script counts opt-outs in its summary so accumulated debt is visible.
