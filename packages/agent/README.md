# @workkit/agent

Composable agent loop primitives for Cloudflare Workers. Typed tools (Standard Schema), multi-turn loops with mandatory budget enforcement, agent-to-agent handoffs, typed streaming events, and lifecycle hooks. Provider-agnostic via [`@workkit/ai-gateway`](../ai-gateway).

## Install

```bash
bun add @workkit/agent @workkit/ai-gateway zod
```

## Quick start

```ts
import { z } from "zod";
import { createGateway } from "@workkit/ai-gateway";
import { defineAgent, tool, handoff } from "@workkit/agent";

const gateway = createGateway({
  providers: { ai: { type: "workers-ai", binding: env.AI } },
  defaultProvider: "ai",
});

const getQuote = tool({
  name: "get_quote",
  description: "Get the latest price for a stock",
  input: z.object({ symbol: z.string() }),
  output: z.object({ price: z.number() }),
  handler: async ({ symbol }) => ({ price: 100 }),
});

const analyst = defineAgent({
  name: "market-analyst",
  model: "@cf/meta/llama-3.1-8b-instruct",
  provider: gateway,
  instructions: "You are a market analyst. Use tools to answer.",
  tools: [getQuote],
  stopWhen: { maxSteps: 5, maxTokens: 50_000 },
});

const result = await analyst.run({ messages: [{ role: "user", content: "What's NIFTY?" }] });
console.log(result.text, result.stopReason, result.usage);

// Streaming
for await (const event of analyst.stream({ messages: [{ role: "user", content: "..." }] })) {
  if (event.type === "text-delta") process.stdout.write(event.delta);
  if (event.type === "tool-end") console.log("tool", event.call.name, "→", event.result);
}
```

## API

### `tool({ name, description, input, output?, handler, timeoutMs? })`

Standard Schema validates `input` before the handler runs. If `output` is supplied, the handler's return value is validated. Per-tool timeout default 30s. Tool name must match `/^[a-zA-Z_][a-zA-Z0-9_-]*$/`.

### `defineAgent({ name, model, provider, instructions?, tools?, stopWhen?, hooks? })`

- `provider` — `Gateway` from `@workkit/ai-gateway`.
- `stopWhen.maxSteps` — default `10`. Mandatory cap; loop never runs forever.
- `stopWhen.maxTokens` — default unset; checked against cumulative `usage.totalTokens` after each step.
- `hooks.beforeModel(ctx)` — fires before each provider call.
- `hooks.afterTool(call, result, ctx)` — fires after each tool resolution.
- `hooks.onError({ kind, toolName?, error }, ctx)` — fires on tool / provider / hook errors. Return `{ abort: true }` to escalate; otherwise loop continues.

### `agent.run({ messages, context? })` → `{ text, messages, usage, stopReason }`

`stopReason` is one of `"stop" | "max_steps" | "max_tokens" | "abort" | "error"`.

### `agent.stream({ messages, context? })` → `AsyncIterable<AgentEvent>`

Typed discriminated union — `step-start`, `text-delta`, `tool-start`, `tool-end`, `handoff`, `step-complete`, `error`, `done`.

### `handoff(targetAgent, { when?, description? })`

Returns a synthetic tool the model can call to switch agents. Cycle detection rejects re-entries past `HANDOFF_HOP_LIMIT` (default 3).

## Security defaults

- **Tool input validated** via Standard Schema before the handler runs. Bad input → `ToolValidationError` surfaces to the loop and is delivered to the model as a tool-error message.
- **Tool handler errors do not silently swallow.** They surface as tool-error messages and as `onError` hook calls. The hook decides whether to abort.
- **Per-tool timeout** (default 30s) bounds latency; an unresponsive tool can't stall the loop.
- **Abort signal propagates** to the provider call and short-circuits before the next step.
- **Handoff cycles capped** at 3 re-entries; raises `HandoffCycleError`.
- **Tool name collisions rejected at `defineAgent` time** including against handoff target tools.
- **Logger redaction** — the loop emits `text-delta` events containing model output. Wire your own logger to scrub PII before storage.

## Out of scope (v1 — follow-up issues)

- `@modelcontextprotocol/sdk` MCP client integration.
- `bindToAgent` Durable Object helper.
- Scratchpad compaction strategies.
- `maxCostUSD` budget (depends on per-provider pricing surface unification).

## Versioning

Follows the workkit Constitution — single `src/index.ts` export, Standard Schema only, no cross-package imports outside declared peer deps. Changesets accompany every public API change.
