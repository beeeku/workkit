# Feature: @workkit/agent — composable agent loop primitives

Tracks GitHub issue #25.

## Problem Statement

`@workkit/ai` already has tool-use primitives (`aiWithTools`, `ToolRegistry`) but they're Workers-AI-specific and lack the agent-loop ergonomics callers need: lifecycle hooks, multi-agent handoffs, typed streaming events, and Standard Schema validation on tool input/output. Without `@workkit/agent`, every product builds these on top of `@workkit/ai-gateway` ad-hoc and the conventions diverge.

If we don't solve this, entryexit's "Research Desk" multi-agent flow has nowhere clean to land, every consumer reinvents `stopWhen` budget enforcement, and tool-handler abort/timeout/error semantics drift package-by-package.

## Target User

- **Primary**: workkit consumers building LLM-powered features (entryexit's analyst flows first; future SaaS products next).
- **Secondary**: workkit package authors who need a stable agent surface to compose with.

## User Stories

- As a product engineer, I want `tool({ name, input: zodSchema, handler })` so the model only sees validated args and my handler is fully typed.
- As a product engineer, I want `defineAgent({ model, tools, stopWhen })` so I get a multi-turn loop with mandatory budget enforcement.
- As a multi-agent designer, I want `handoff(otherAgent, { when })` so a triage agent can route to specialists.
- As an SRE, I want typed streaming events so I can ship reliable UIs and observability.
- As a security engineer, I want tool outputs treated as untrusted by default and `afterTool` hooks where I can scrub PII.

## Success Criteria

- [ ] `tool()` validates input via Standard Schema; tests cover Zod + Valibot.
- [ ] `defineAgent()` enforces `stopWhen.maxSteps` and `stopWhen.maxTokens`; result has a `stopReason`.
- [ ] Tool handler `throw` becomes a tool-error message to the model; no silent swallow.
- [ ] Per-tool timeout (default 30s) honored; abort signal propagates.
- [ ] Handoff cycle detection rejects after N (default 3) re-entries.
- [ ] Streaming events are a typed discriminated union; tests assert ordering.
- [ ] `beforeModel` / `afterTool` / `onError` hooks fire in documented order.
- [ ] Tool name collisions rejected at `defineAgent` time.
- [ ] `@workkit/testing` integration present.
- [ ] Single `src/index.ts` export.
- [ ] Changeset added.
- [ ] LOC budget ≤700 source.

## Scope (v1)

### In Scope

- `tool({ name, description, input, output?, handler })` with Standard Schema input/output validation.
- `defineAgent({ name, model, provider, instructions, tools, stopWhen, hooks })`.
- `agent.run({ messages, context })` — non-streaming, returns `{ text, messages, usage, stopReason }`.
- `agent.stream({ messages, context })` — async iterator of typed events.
- `handoff(targetAgent, { when, description? })` — synthetic tool that switches active agent.
- `stopWhen`: `maxSteps`, `maxTokens`.
- Hooks: `beforeModel(ctx)`, `afterTool(call, result, ctx)`, `onError(err, ctx)`.
- Per-tool timeout option; abort signal propagation.
- Provider-agnostic via `@workkit/ai-gateway`.

### Out of Scope (follow-up issues)

- MCP client integration → follow-up.
- `bindToAgent` Durable Object helper → follow-up (depends on `@workkit/do` shape decisions).
- Scratchpad compaction → follow-up.
- `maxCostUSD` budget (depends on per-provider pricing model not yet uniform).
- Long-term vector memory.
- Built-in tracing (use `@workkit/logger` + emitted events).

## Design Decisions

- **Reuse `@workkit/ai`'s `ToolDefinition` shape internally** but the public API is `tool({ ... })` so we can layer Standard Schema without forcing callers to write JSON Schema by hand.
- **Standard Schema for input/output** so Zod, Valibot, ArkType all work identically. JSON Schema generated at registration.
- **Linear loop + handoffs only**. Issue #25 explicitly leaves graphs out.
- **Tool handler errors propagate as tool-error messages** by default; `hooks.onError` can elect to abort. Silent swallow is never an option.
- **Per-tool timeout default 30s**. Configurable per-tool and per-agent.
- **Handoff cycle detection at runtime** via agent path tracking; reject re-entry beyond N (default 3).
- **Hooks return `void | Promise<void>`** — observe + mutate context, don't replace loop body.

## Open Questions

- Is `usage` reliably reported across providers via `@workkit/ai-gateway`? — verify during implementation; fall back to `estimateTokens` if not.
- Should handoffs share message history (default) or restart? — Default share; revisit after entryexit Research Desk lands.
- Per-token vs per-chunk text deltas? — Start with per-chunk (provider-native).
