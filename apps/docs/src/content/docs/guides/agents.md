---
title: "Agents"
---

# Agents

`@workkit/agent` is a thin agent-loop primitive on top of [`@workkit/ai-gateway`](/workkit/guides/ai-integration/). Typed tools (Standard Schema), multi-turn loops with mandatory budgets, multi-agent handoffs, typed streaming events, lifecycle hooks. Provider-agnostic.

It's not a framework — there's no state graph, no DSL. Just composable primitives.

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

const result = await analyst.run({
  messages: [{ role: "user", content: "What's NIFTY?" }],
});
console.log(result.text, result.stopReason, result.usage);
```

## Streaming

```ts
for await (const event of analyst.stream({
  messages: [{ role: "user", content: "..." }],
})) {
  if (event.type === "text-delta") process.stdout.write(event.delta);
  if (event.type === "tool-end") console.log(event.call.name, "→", event.result);
}
```

Event union: `step-start | text-delta | tool-start | tool-end | handoff | step-complete | error | done`.

## Handoffs

```ts
import { handoff } from "@workkit/agent";

const fundamentalsAnalyst = defineAgent({ /* ... */ });
const technicalAnalyst = defineAgent({ /* ... */ });

const desk = defineAgent({
  name: "research-desk",
  model: "@cf/meta/llama-3.1-8b-instruct",
  provider: gateway,
  tools: [
    handoff(fundamentalsAnalyst, { when: "valuation, earnings" }),
    handoff(technicalAnalyst, { when: "price action, levels" }),
  ],
});
```

`handoff()` returns a synthetic tool the model invokes to switch agents. Cycle detection rejects after `HANDOFF_HOP_LIMIT` (default 3) re-entries with `HandoffCycleError`.

## API

### `tool({ name, description, input, output?, handler, timeoutMs? })`

- Standard Schema validates `input` before the handler runs.
- Optional `output` schema validated on handler return.
- Per-tool timeout default 30s. Aborted via `AbortSignal`.
- Tool name must match `/^[a-zA-Z_][a-zA-Z0-9_-]*$/`.

### `defineAgent({ name, model, provider, instructions?, tools?, stopWhen?, hooks? })`

- `provider` — `Gateway` from `@workkit/ai-gateway`.
- `stopWhen.maxSteps` — default `10`. Mandatory cap; loop never runs forever.
- `stopWhen.maxTokens` — checked against cumulative `usage.totalTokens` after each step.
- `hooks.beforeModel(ctx)` — fires before each provider call.
- `hooks.afterTool(call, result, ctx)` — fires after each tool resolution.
- `hooks.onError({ kind, toolName?, error }, ctx)` — fires on tool/provider/hook errors. Return `{ abort: true }` to escalate; otherwise loop continues.

### `agent.run({ messages, context? })`

Returns `{ text, messages, usage, stopReason }`. `stopReason ∈ stop | max_steps | max_tokens | abort | error`.

### `agent.stream({ messages, context? })`

Async iterator of typed `AgentEvent`s.

### `handoff(targetAgent, { when?, description? })`

Synthetic handoff tool. Pass the **full** agent (not just `{ name }`) so collision detection can transit through target tools.

## Security defaults

- **Tool input validated** before the handler runs. Bad input → `ToolValidationError` becomes a tool-error message to the model.
- **Tool handler errors do not silently swallow.** They surface as tool-error messages and as `onError` hook calls.
- **Per-tool timeout** (default 30s) with abort propagation into handler bodies.
- **Abort signal** propagates to the provider call AND in-flight tool handlers.
- **Handoff cycles capped** at 3 re-entries; raises `HandoffCycleError`.
- **Tool name collisions rejected at `defineAgent` time** including against handoff target tools.
- **Provider failures rethrow by default.** `onError` must explicitly return `{ abort: false }` to recover with `stopReason:'stop'`.

## Out of scope (v1 — follow-ups)

- `@modelcontextprotocol/sdk` MCP client integration.
- `bindToAgent` Durable Object helper.
- Scratchpad compaction strategies.
- `maxCostUSD` budget (depends on per-provider pricing surface unification).

## See also

- [AI Integration](/workkit/guides/ai-integration/) — `@workkit/ai-gateway` primer.
- [Notifications](/workkit/guides/notifications/) — agents often produce notifications as side effects.
