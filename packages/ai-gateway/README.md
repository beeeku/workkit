# @workkit/ai-gateway

> Multi-provider AI gateway with routing, cost tracking, caching, logging, retry, streaming, and Cloudflare AI Gateway support

[![npm](https://img.shields.io/npm/v/@workkit/ai-gateway)](https://www.npmjs.com/package/@workkit/ai-gateway)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/ai-gateway)](https://bundlephobia.com/package/@workkit/ai-gateway)

## Install

```bash
bun add @workkit/ai-gateway
```

## Quickstart

```ts
import { createGateway, withRetry } from "@workkit/ai-gateway"

const gateway = withRetry(createGateway({
  providers: {
    anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
    openai:    { type: "openai",    apiKey: env.OPENAI_KEY },
    workers:   { type: "workers-ai", binding: env.AI },
  },
  // Route Anthropic & OpenAI through Cloudflare AI Gateway for caching + logs + cost tracking
  cfGateway: { accountId: env.CF_ACCOUNT_ID, gatewayId: "my-gateway" },
  defaultProvider: "anthropic",
}))

const result = await gateway.run("claude-sonnet-4-6", {
  messages: [{ role: "user", content: "Hello" }],
})
// result.text, result.usage, result.provider, result.model, result.toolCalls
```

## Features

| Feature | API |
|---|---|
| Multi-provider dispatch (Workers AI, OpenAI, Anthropic, custom) | `createGateway({ providers })` |
| Cloudflare AI Gateway routing + caching + cost dashboards | `createGateway({ cfGateway })` |
| Automatic retry on retryable errors | `withRetry(gateway)` |
| Response caching via KV | `withCache(gateway, { storage })` |
| Request/response logging | `withLogging(gateway, { onRequest, onResponse, onError })` |
| Cost + budget tracking | `createCostTracker({ pricing })` |
| Model → provider routing | `createRouter({ routes, fallback })` |
| Structured JSON output | `run(model, input, { responseFormat: "json" \| { jsonSchema } })` |
| Tool use | `run(model, input, { toolOptions: { tools, toolChoice } })` |
| Anthropic prompt caching | `{ role, content, cacheControl: "ephemeral" }` in `messages` |
| Cross-provider server-side fallback | `gateway.runFallback(entries, input)` |
| Streaming (text + tool_use + done) | `gateway.stream(model, input)` |
| Per-provider model allowlist (tree-shakeable sub-export) | `import { createModelAllowlist } from "@workkit/ai-gateway/allowlist"` |

## Cloudflare AI Gateway

Route HTTP-based providers (OpenAI, Anthropic) through your [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/). Calls go to `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/{provider}/…` and `cf-aig-*` headers are injected automatically.

```ts
createGateway({
  providers: {
    anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
    openai:    { type: "openai",    apiKey: env.OPENAI_KEY },
  },
  cfGateway: {
    accountId: env.CF_ACCOUNT_ID,
    gatewayId: "my-gateway",
    authToken: env.CF_AIG_TOKEN,  // → cf-aig-authorization (optional)
    cacheTtl: 3600,                // → cf-aig-cache-ttl (optional)
    skipCache: false,              // → cf-aig-skip-cache (optional)
  },
  defaultProvider: "anthropic",
})
```

Explicit `baseUrl` on a provider config overrides `cfGateway`. Workers AI and custom providers are unaffected.

## Retry

`withRetry` retries retryable errors (`ServiceUnavailableError`, `TimeoutError`, `RateLimitError`) using each thrown `WorkkitError`'s own `retryStrategy` — no delay config needed. Per-call `AbortSignal` aborts the retry loop.

```ts
import { withRetry } from "@workkit/ai-gateway"

const resilient = withRetry(gateway, { maxAttempts: 3 })
await resilient.run("claude-sonnet-4-6", { prompt: "…" })
```

A custom `isRetryable` hook can override the default (which checks `WorkkitError.retryable`):

```ts
withRetry(gateway, {
  maxAttempts: 5,
  isRetryable: (err) => /* your logic */,
})
```

## Server-side fallback (Cloudflare Universal Endpoint)

`runFallback` POSTs a provider chain to the [CF Universal Endpoint](https://developers.cloudflare.com/ai-gateway/configuration/universal-endpoint/). Cloudflare tries each entry server-side in order and returns the first success. Requires `cfGateway`.

```ts
const result = await gateway.runFallback(
  [
    { provider: "anthropic", model: "claude-sonnet-4-6" },
    { provider: "openai",    model: "gpt-4o" },
  ],
  { messages: [{ role: "user", content: "hi" }] },
)
// result.provider tells you which one served the response
```

Only `openai` and `anthropic` entries are supported; `workers-ai` and `custom` providers throw `ValidationError`.

## Anthropic prompt caching

Mark long-lived context with `cacheControl: "ephemeral"` and it becomes a [prompt-cached content block](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — cheaper and faster on repeat calls. Non-Anthropic providers silently ignore the flag.

```ts
await gateway.run("claude-sonnet-4-6", {
  messages: [
    { role: "system", content: longDocument, cacheControl: "ephemeral" },
    { role: "user",   content: "summarize this" },
  ],
})
```

## Streaming

`gateway.stream()` returns a typed `ReadableStream<GatewayStreamEvent>`:

```ts
type GatewayStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done"; usage?: TokenUsage; raw?: unknown }
```

Every stream ends with exactly one `done` event. Supported providers: Workers AI, Anthropic SSE, OpenAI SSE. Tool-use events are emitted when the model completes a tool call mid-stream (Anthropic `input_json_delta` accumulation; OpenAI `tool_calls` delta accumulation). Malformed tool-argument JSON falls back to `input: {}` rather than failing the stream.

```ts
const stream = await gateway.stream("claude-sonnet-4-6", {
  messages: [{ role: "user", content: "explain quantum tunneling" }],
})

const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  if (value.type === "text") process.stdout.write(value.delta)
  if (value.type === "tool_use") handleToolCall(value)
  if (value.type === "done") console.log("usage:", value.usage)
}
```

Consumer-cancel (`reader.cancel()` or `stream.cancel()`) propagates to the upstream fetch, so you stop paying for tokens you're not reading.

> **Note on `responseFormat` + streaming.** Passing `responseFormat: "json"` adds a system prompt asking for JSON only, but the output is still a token-by-token `text` stream. Consumers must buffer and parse the concatenated deltas themselves.

## Model allowlist

Validate untrusted model strings (e.g. a `?model=` query-param override) against a curated per-provider list. Ships as the `@workkit/ai-gateway/allowlist` sub-export so callers that don't need it pay zero bytes.

```ts
import { createModelAllowlist } from "@workkit/ai-gateway/allowlist"

const allow = createModelAllowlist({
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
  openai:    ["gpt-4o", "gpt-4o-mini"],
  groq:      [{ prefix: "llama-3.1-" }], // prefix rule for families
})

const requested = url.searchParams.get("model") ?? DEFAULT_MODEL
if (!allow.isAllowed("anthropic", requested)) {
  return new Response("model not in allowlist", { status: 400 })
}
```

Matcher semantics: exact strings use strict equality; `{ prefix }` uses `model.startsWith(prefix)`; unknown providers and empty matcher arrays return `false`. A functional form `isAllowedModel(config, provider, model)` is also exported for one-off checks.

## Tool use (non-streaming)

```ts
const result = await gateway.run("claude-sonnet-4-6", {
  messages: [{ role: "user", content: "what's the weather in SF?" }],
}, {
  toolOptions: {
    tools: [{
      name: "get_weather",
      description: "Get the current weather for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
    }],
    toolChoice: "auto",
  },
})

if (result.toolCalls) {
  for (const call of result.toolCalls) {
    const output = await runTool(call.name, call.arguments)
    // …feed back in a follow-up turn
  }
}
```

Normalized shape works identically across Workers AI, OpenAI, and Anthropic.

## Routing, cost tracking, caching, logging

```ts
import {
  createGateway, createRouter, createCostTracker,
  withCache, withLogging, withRetry,
} from "@workkit/ai-gateway"

const gateway = createGateway({
  providers: {
    anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
    openai:    { type: "openai",    apiKey: env.OPENAI_KEY },
    workers:   { type: "workers-ai", binding: env.AI },
  },
  defaultProvider: "workers",
})

// Model → provider routing
const router = createRouter({
  routes: [
    { pattern: "gpt-*",     provider: "openai" },
    { pattern: "claude-*",  provider: "anthropic" },
    { pattern: "@cf/*",     provider: "workers" },
  ],
  fallback: "workers",
})

// Cost + budget
const costs = createCostTracker({
  pricing: {
    "gpt-4o":            { input: 2.5,  output: 10.0 },
    "claude-sonnet-4-6": { input: 3.0,  output: 15.0 },
  },
})

// Stack middleware (applies right-to-left at call time)
const enhanced =
  withRetry(
    withLogging(
      withCache(gateway, { storage: env.AI_CACHE_KV, ttl: 3600 }),
      { onRequest: (m, i) => console.log("→", m), onError: (m, e) => console.error("✗", m, e) },
    ),
    { maxAttempts: 3 },
  )
```

All wrappers conditionally expose `stream` and `runFallback` — they pass through to the underlying gateway when the underlying gateway implements them.

## API reference

### Factory

- **`createGateway(config)`** → `Gateway`
  - `.run(model, input, opts?)` — one-shot inference.
  - `.runFallback(entries, input, opts?)` — CF Universal Endpoint chain (optional; requires `cfGateway`).
  - `.stream(model, input, opts?)` — typed event stream (optional).
  - `.providers()` / `.defaultProvider()` — metadata.

### Middleware

| Wrapper | Purpose |
|---|---|
| `withRetry(gw, { maxAttempts?, isRetryable? })` | Retry retryable errors. |
| `withCache(gw, { storage, ttl?, hashFn? })` | KV-backed response cache (applies to `run` only, not `stream`/`runFallback`). |
| `withLogging(gw, { onRequest?, onResponse?, onError? })` | Observability hooks. |

### Standalone

| API | Purpose |
|---|---|
| `createRouter({ routes, fallback })` | Map a model name to a provider key. |
| `createCostTracker({ pricing })` | Record usage, compute totals, check budgets. |

### Provider types

- `workers-ai` — Cloudflare Workers AI (uses `binding`).
- `openai` — OpenAI-compatible APIs (`apiKey`, optional `baseUrl`).
- `anthropic` — Anthropic Claude (`apiKey`, optional `baseUrl`).
- `custom` — any provider with a user-supplied `run(model, input)`.

### Exported types

`AiInput`, `AiOutput`, `ChatMessage`, `TokenUsage`, `RunOptions`, `GatewayStreamEvent`, `FallbackEntry`, `CfGatewayConfig`, `RetryConfig`, `GatewayToolDefinition`, `GatewayToolCall`, `GatewayToolOptions`, plus provider-config types.

## Roadmap

- `@workkit/ai` + `@workkit/ai-gateway` consolidation — see [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md) and tracking issue [#63](https://github.com/beeeku/workkit/issues/63).
- Workers AI tool-call streaming (currently text-only for that provider).

## License

MIT
