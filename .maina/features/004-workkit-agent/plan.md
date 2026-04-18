# Implementation Plan — @workkit/agent

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: functional. `tool({...})` returns a `Tool` record. `defineAgent({...})` returns an `Agent` object with `run` / `stream` / `meta`.
- **Layering**:
  - `tool.ts` — Standard Schema validation, JSON Schema generation, timeout wrapper.
  - `events.ts` — typed discriminated union for stream events.
  - `loop.ts` — single-agent step-by-step loop with hooks + stopWhen.
  - `handoff.ts` — synthetic handoff tools + cycle detection.
  - `agent.ts` — `defineAgent` factory, `run` / `stream` orchestration.
- **Integration points**:
  - `@workkit/ai-gateway` `Gateway` for provider calls.
  - `@workkit/ai`'s `ToolDefinition` reused as the wire shape sent to the gateway.
  - `@workkit/errors` for normalized error types.
  - `@standard-schema/spec` for input/output validation.

## Key Technical Decisions

- **Standard Schema only at the public surface** — accepted shapes: anything with `~standard.validate`. Internally we resolve to JSON Schema via a generic adapter (Zod and Valibot ship JSON-Schema converters; we wire those when present, fall back to `parameters: {}` only with explicit warning).
- **`run` and `stream` share a single internal step engine** (`runStep`). `run` collects events to memory; `stream` yields them.
- **Handoffs are synthetic tools** named `handoff_<targetAgentName>` so the model treats them like any other tool. Activation switches the loop's `currentAgent`.
- **Cycle detection** tracks `agentPath: string[]` in context; counts re-entries per agent; throws `HandoffCycleError` past the limit.
- **Tool name collisions** asserted at `defineAgent` time by walking own tools + handoff target tools.
- **Per-tool timeout** wraps `handler(args, ctx)` in a `Promise.race` with a `setTimeout` that throws `TimeoutError`.
- **Abort signal** lives on `RunContext`. We pass it into provider calls (gateway already accepts it) and check it before each step.
- **`stopReason`** values: `"max_steps"` | `"max_tokens"` | `"stop"` | `"abort"` | `"error"`.

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/agent/package.json` | Manifest | New |
| `packages/agent/tsconfig.json`, `bunup.config.ts`, `vitest.config.ts` | Build/test config | New |
| `packages/agent/src/index.ts` | Public exports | New |
| `packages/agent/src/types.ts` | `Tool`, `Agent`, `RunContext`, `RunResult`, `StopReason`, message shapes | New |
| `packages/agent/src/tool.ts` | `tool()` factory + Standard Schema bridge + timeout wrapper | New |
| `packages/agent/src/schema.ts` | Standard Schema → JSON Schema conversion (via per-vendor JSON Schema if present) | New |
| `packages/agent/src/events.ts` | `AgentEvent` discriminated union | New |
| `packages/agent/src/loop.ts` | `runStep` (single iteration); used by both `run` and `stream` | New |
| `packages/agent/src/handoff.ts` | `handoff()` factory + cycle detection helpers | New |
| `packages/agent/src/agent.ts` | `defineAgent`, `run`, `stream` | New |
| `packages/agent/src/errors.ts` | `HandoffCycleError`, `ToolValidationError`, `BudgetExceededError` | New |
| `packages/agent/tests/tool.test.ts` | Standard Schema validation (Zod + Valibot), timeout, error mapping | New |
| `packages/agent/tests/loop.test.ts` | stopWhen budgets; tool execute; tool error → tool-error message | New |
| `packages/agent/tests/handoff.test.ts` | Successful handoff, cycle detection, name collision | New |
| `packages/agent/tests/stream.test.ts` | Event ordering, abort propagation | New |
| `packages/agent/tests/_mocks.ts` | Mock Gateway + assertion helpers | New |
| `packages/agent/README.md` | Public docs incl. security notes | New |
| `.changeset/feat-agent-init.md` | `@workkit/agent@0.1.0` | New |

## Tasks (TDD red→green)

1. **scaffold** — package.json, tsconfig, bunup, vitest, README stub.
2. **test:tool** → **impl:tool** — `tool()` validates input via Standard Schema; throws `ToolValidationError`; timeout enforcement.
3. **test:schema** → **impl:schema** — `toJsonSchema(standardSchema)` extracts JSON Schema from Zod/Valibot when available; falls back to `{}` with warning.
4. **test:events** → **impl:events** — `AgentEvent` union compiles; type-narrowing works.
5. **test:loop** (mock gateway) → **impl:loop** — single step calls gateway, dispatches tools, returns next state; stopWhen enforcement.
6. **test:handoff** → **impl:handoff** — synthetic tool registration, cycle detection, collision rejection.
7. **test:agent** → **impl:agent** — `defineAgent`, `run` collects, `stream` yields.
8. **test:stream** — event ordering, abort propagation across steps.
9. **wire** `src/index.ts`.
10. **lint + typecheck + scoped tests**.
11. **maina verify**.
12. **changeset**.
13. **maina commit**.
14. **push + PR**.
15. **request review**.

## Failure Modes

- **Tool input validation failure** — model produced bad JSON. Default: surface as a tool-error message and let the model retry once. After retry, escalate to `BudgetExceededError`-equivalent.
- **Tool handler exception** — converted to tool-error message by default; `onError` hook gets first crack with `{ kind: "tool", toolName, error }` and can mark the loop as fatal.
- **Provider call failure** — bubble through as `WorkkitError` from `@workkit/errors`. `onError` hook fires with `{ kind: "provider", error }`.
- **Tool timeout** — handler `Promise.race` rejects with `TimeoutError`; treated like any other handler exception.
- **stopWhen exhaustion** — return cleanly with `stopReason`; do not throw.
- **Handoff cycle** — `HandoffCycleError` thrown synchronously from inside the loop; the partial result is preserved on the error's `context`.
- **Tool name collision** — `defineAgent` throws `ConfigError` synchronously.
- **Hook throws** — `beforeModel` throw aborts the step (treated as `onError` `{ kind: "hook" }`); `afterTool` throw is logged but does not abort unless `onError` says so.

## Testing Strategy

- **Mocks**: hand-rolled Gateway mock (`tests/_mocks.ts`) returning configurable response sequences. Each test composes the response stream the gateway should return; the loop drives it.
- **Standard Schema vendors**: import `zod` and `valibot` (already devDeps) to verify cross-vendor validation works without adapter code.
- **Streaming**: mock gateway exposes a stream (async iterator); test asserts the resulting `AgentEvent` ordering matches expectations.
- **No e2e**: provider-real calls are out of scope for unit tests; an example app in `examples/agent-chatbot/` (separate PR) will exercise the full path.


## Wiki Context

Auto-populated; no edits needed.
