# Project Constitution

Non-negotiable rules. Injected into every AI call.

## Stack
- Runtime: Bun (NOT Node.js)
- Language: TypeScript strict mode
- Lint/Format: biome (indentStyle: tab, lineWidth: 100)
- Test: vitest (via `turbo test`)
- Build: bunup (per-package), turbo (orchestrator)
- Monorepo: yes (bun workspaces)
- Package manager: bun@1.3.8

## Architecture
- **Domain:** Cloudflare Workers utility toolkit (@workkit/*)
- **Workspaces:**
  - `packages/*` — 24 core packages (ai, api, auth, cache, cron, crypto, d1, do, env, errors, kv, logger, mail, mcp, memory, queue, r2, ratelimit, testing, types, workflow, ai-gateway, approval, cli)
  - `integrations/*` — 3 framework adapters (hono, astro, remix)
  - `apps/*` — documentation site (Astro + Starlight)
  - `tooling/*` — shared tsconfig
  - `examples/*` — 9 example apps
- **Key patterns:** Standard Schema validation, typed bindings, Result types, branded IDs
- **Target platform:** Cloudflare Workers (uses @cloudflare/workers-types)

## Verification
- Lint: `biome check .`
- Typecheck: `turbo typecheck`
- Test: `turbo test`
- Build: `turbo build`
- Diff-only: only report findings on changed lines

## Conventions
- GitHub Actions CI/CD
- Conventional commits (feat, fix, refactor, test, docs, chore, ci, perf)
- Changesets for versioning (@changesets/cli)
- No `console.log` in production code
- Type checking enforced
- biome rules: noExplicitAny off, noNonNullAssertion off, noParameterAssign off
