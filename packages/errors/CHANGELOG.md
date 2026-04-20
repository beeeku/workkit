# @workkit/errors

## 1.0.4

### Patch Changes

- b26dbbc: **Register `WORKKIT_AGENT_OFF_PALETTE_TOOL` in the central error code union.** `OffPaletteToolError` (added in #88 / strictTools) was carrying its code via `as unknown as WorkkitErrorCode` because the `@workkit/errors` union was out of diff-only scope for that PR. The cast worked at runtime but defeated exhaustive-switch analysis for consumers pattern-matching on `err.code`.

  The code now lives in the `WorkkitErrorCode` union and `OffPaletteToolError` declares it as a literal `as const` — no behavior change, just type integrity.

  Closes #93.

## 1.0.3

### Patch Changes

- 2e8d7f1: Add `@workkit/agent` — composable agent loop primitives for Cloudflare Workers.

  - **`tool({ name, description, input, output?, handler })`** — Standard Schema
    validates input before the handler runs (tested against Zod and Valibot);
    optional output schema; per-tool timeout default 30s.
  - **`defineAgent({ name, model, provider, tools, stopWhen, hooks })`** —
    multi-turn loop with mandatory `stopWhen.maxSteps` (default 10) and
    optional `stopWhen.maxTokens` cumulative budget. Returns `{ text, messages,
usage, stopReason }`.
  - **`agent.stream()`** — typed `AgentEvent` discriminated union (`step-start`,
    `text-delta`, `tool-start`, `tool-end`, `handoff`, `step-complete`, `error`,
    `done`).
  - **`handoff(targetAgent, { when?, description? })`** — synthetic handoff
    tool with cycle detection (default 3 re-entries → `HandoffCycleError`).
  - **Hooks** — `beforeModel(ctx)`, `afterTool(call, result, ctx)`,
    `onError(err, ctx)` with optional `{ abort: true }` decision.
  - **Provider-agnostic** via `@workkit/ai-gateway`'s `Gateway`.
  - Tool name collisions rejected at `defineAgent` time, including against
    handoff target tools.

  Out of scope (v1 — follow-up issues): MCP client integration, Durable Object
  binding helper, scratchpad compaction, `maxCostUSD` budget.

  `@workkit/errors` adds the `WORKKIT_AGENT_HANDOFF_CYCLE` and
  `WORKKIT_AGENT_BUDGET` codes used by the new agent error classes.

  Closes #25.

## 1.0.2

### Patch Changes

- Add `WORKKIT_TURNSTILE` to the `WorkkitErrorCode` union type.

## 1.0.1

### Patch Changes

- Fix workspace:_ dependencies leaking into published packages. Added resolve script to replace workspace:_ with actual semver versions before npm publish.
- Updated dependencies
  - @workkit/types@1.0.1

## 1.0.0

### Minor Changes

- First stable release of the workkit Cloudflare Workers utility suite.

  ### Highlights

  - **18 packages** covering the full Cloudflare Workers API surface: KV, D1, R2, Queues, Durable Objects, Cron, Cache, Rate Limiting, Crypto, AI, AI Gateway, API routing, Auth, and Environment validation
  - **3 framework integrations**: Hono, Astro, and Remix middleware with typed env and error handling
  - **CLI** (`npx workkit`): scaffolding, validation, migrations, seeding, client generation, and docs generation
  - **Testing utilities** (`@workkit/testing`): in-memory mocks for all Cloudflare bindings
  - **Zero runtime dependencies** — each package is self-contained with full TypeScript types
  - **Standard Schema support** — works with Zod, Valibot, or any Standard Schema compliant validator

  ### Fixes since 0.0.1

  - CLI now bundles internal dependencies (fixes `npx workkit` failing with protocol error)
  - All lint and a11y issues resolved
  - Full test coverage: 2,456+ unit tests, 245 e2e tests
  - Clean typecheck across all packages

### Patch Changes

- Updated dependencies
  - @workkit/types@1.0.0
