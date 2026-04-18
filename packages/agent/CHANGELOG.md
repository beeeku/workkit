# @workkit/agent

## 0.2.0

### Minor Changes

- 38a29b9: **Streaming text via `agent.stream()`.** When the configured gateway exposes `gateway.stream()` (i.e. `@workkit/ai-gateway@>=0.3.0` with a streaming-capable provider), the agent loop now streams each model step and emits `text-delta` events per token as they arrive, instead of once per step with the full text. Closes #68.

  ```ts
  const agent = defineAgent({ provider: gateway /* … */ });

  for await (const event of agent.stream({ messages })) {
    if (event.type === "text-delta") process.stdout.write(event.delta);
    if (event.type === "tool-start") console.log("tool:", event.call.name);
    if (event.type === "done") console.log("stopped:", event.stopReason);
  }
  ```

  Behavior:

  - If `gateway.stream` exists, each step uses it; text deltas arrive as the model produces them.
  - If `gateway.stream` is not implemented, falls back to `gateway.run` and synthesizes a single `text-delta` per step (matches pre-0.2.x behavior).
  - Tool calls collected from the stream's `tool_use` events are dispatched by the loop exactly as before — hooks, handoffs, and stop reasons are unchanged.
  - `options.signal` and `stopWhen` cap streaming the same way they cap non-streaming.

  No breaking changes; public `AgentEvent` shape is unchanged.

### Patch Changes

- dcb8d1b: **Follow-up fixes from Copilot review on PRs #70–#72.**

  `@workkit/agent`:

  - Streaming step now always returns a defined `AiOutput.raw` (falls back to `{}` if the provider's terminal `done` event doesn't include `raw`), satisfying the `Gateway` output contract.
  - New regression test: consumer aborts mid-stream → the model stream surfaces the abort.
  - Doc comment on `mockStreamingGateway` corrected to cover both `run()` and `stream()` paths.

  `@workkit/ai`:

  - `calculateDelay` and `defaultIsRetryable` now also carry `@deprecated` JSDoc (they're internal helpers for the deprecated `withRetry`). The claim in the earlier changeset that "every public export now carries `@deprecated`" is now accurate.
  - `createToolRegistry` guidance corrected: `@workkit/ai-gateway` does not re-export this helper. Migrating callers can keep using it from `@workkit/ai` until the v2.0 removal or inline the equivalent `Map<string, handler>`.
  - README migration table: `await` added to the "before" column examples (they were all async), and the `fallback` → `runFallback` row now notes the `cfGateway` prerequisite and the Workers-AI-only fallback path.

- Updated dependencies [3535cb1]
- Updated dependencies [62d460d]
  - @workkit/ai-gateway@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [caec293]
- Updated dependencies [caec293]
- Updated dependencies [caec293]
- Updated dependencies [caec293]
- Updated dependencies [caec293]
- Updated dependencies [caec293]
  - @workkit/ai-gateway@0.3.0

## 0.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [2e8d7f1]
  - @workkit/errors@1.0.3
