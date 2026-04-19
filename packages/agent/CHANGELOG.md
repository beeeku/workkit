# @workkit/agent

## 0.3.0

### Minor Changes

- 10cce1f: **Add `afterModel` hook for output-side guardrails with retry-and-reminder.** New optional `AgentHooks.afterModel(assistant, ctx)` fires after every assistant turn (text-only, tool-call, or mixed), receives the full assistant message, and may return `{ retry: true, reminder?: string }` to reject the turn and re-run the model. Tools from a rejected turn are **not** executed — the hook call site is between `step-complete` and the strict-tools pre-scan / tool dispatch, so any `tool_calls` on a rejected turn are discarded along with the assistant message.

  Retries consume from `stopWhen.maxSteps` (keeps budgets honest) and are additionally capped per-step by a new `maxAfterModelRetries` option (default `2`). When the per-step cap is hit the loop soft-fails: it proceeds with the last-returned assistant message rather than throwing. Throws from `afterModel` route through `onError({ kind: "hook", error })`; if `onError` returns `{ abort: false }` the throw is suppressed and the turn is treated as no-retry, otherwise the loop terminates with `stopReason: "error"`.

  New event variant `{ type: "after-model-retry", step, attempt, reminder? }` is emitted per retry so consumers can trace guardrail activity. The reminder (when present) is appended as a `{ role: "user", content: reminder }` message before the next model call; the rejected assistant message is popped from history so the model doesn't re-read its own bad output.

  New export: `AfterModelDecision` type. Purely additive — existing agents ignoring the hook see zero behavior change.

  Closes #58.

- d8c9c97: **Add `strictTools` mode for off-palette rejection.** New `defineAgent({ strictTools: true })` opt-in rejects tool calls naming a tool outside the agent's palette: the loop terminates with `stopReason: "error"`, emits a `{ type: "tool-rejected", call, reason: "off-palette", step }` event, throws a typed `OffPaletteToolError` (carrying `toolName` and `allowedPalette`), and does **not** execute any sibling calls from the same assistant turn.

  Default remains `false` — preserves the current soft behavior where unknown tool names return a `"unknown tool: <name>"` tool-result message and the loop continues. Purely additive; zero migration cost.

  Motivation: strong models self-correct after a soft unknown-tool message, but weaker open-weight models (e.g. Llama 3.x routed through CF AI Gateway) tend to double down on hallucinated tool names and burn the entire step budget. Strict mode lets consumers opt into fail-fast when they know their model is weak or need predictable budgets.

  Closes #79.

### Patch Changes

- Updated dependencies [686926d]
- Updated dependencies [8d862f1]
- Updated dependencies [57bc09b]
- Updated dependencies [776a6bc]
  - @workkit/ai-gateway@0.5.0

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
