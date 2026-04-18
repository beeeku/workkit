---
"@workkit/agent": minor
"@workkit/errors": patch
---

Add `@workkit/agent` — composable agent loop primitives for Cloudflare Workers.

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
