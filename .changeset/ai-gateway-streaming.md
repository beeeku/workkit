---
"@workkit/ai-gateway": minor
---

**Streaming via `gateway.stream()`.** New optional method on `Gateway` that returns a `ReadableStream<GatewayStreamEvent>` — a typed, provider-agnostic event stream:

```ts
type GatewayStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done"; usage?: TokenUsage; raw?: unknown };
```

Every stream ends with exactly one `done` event. Consumers that only want text use `for await (const e of stream) if (e.type === "text") { … }`.

Supported providers in this release:
- **Workers AI** — binding stream (`{"response": "…"}` SSE) → text + done.
- **Anthropic** — native SSE (`content_block_delta` → text; `message_delta` usage captured into the final `done`).
- **OpenAI** — native SSE (`choices[].delta.content` → text; final `usage` captured into `done`).
- Routed through CF AI Gateway when `cfGateway` is configured, same as `run()`.

`withCache`, `withLogging`, and `withRetry` each conditionally expose `stream` when the underlying gateway does. `withRetry` retries the initial connect only — mid-stream errors propagate as-is to avoid re-emitting already-delivered tokens.

**Scope notes / roadmap.** The `tool_use` event variant is defined but not emitted by any provider in this PR — Anthropic `input_json_delta` accumulation and OpenAI `tool_calls` delta accumulation land in a follow-up. Additive; no breaking changes.
