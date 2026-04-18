# @workkit/ai

> **⚠️ Deprecated — use [`@workkit/ai-gateway`](../ai-gateway) instead.**
>
> Per [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md), this package is being folded into `@workkit/ai-gateway`. Existing APIs still work today but are marked `@deprecated`; the shim is tracked in [#63](https://github.com/beeeku/workkit/issues/63) and the package will be removed at `@workkit/ai@2.0`.

> Typed Workers AI client with streaming, fallback chains, and retry

[![npm](https://img.shields.io/npm/v/@workkit/ai)](https://www.npmjs.com/package/@workkit/ai)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/ai)](https://bundlephobia.com/package/@workkit/ai)

## Migration

Replace `@workkit/ai` imports with `@workkit/ai-gateway` and construct a gateway over your `env.AI` binding:

| Before (`@workkit/ai`) | After (`@workkit/ai-gateway`) |
|---|---|
| `ai(env.AI).run(model, input)` | `gateway.run(model, input)` |
| `streamAI(env.AI, model, input)` | `gateway.stream!(model, input)` (typed `GatewayStreamEvent`) |
| `fallback(env.AI, [{model, timeout}], input)` | `gateway.runFallback!(entries, input)` (server-side via CF Universal Endpoint) |
| `withRetry(env.AI, model, input, { maxRetries })` | `withRetry(gateway, { maxAttempts }).run(model, input)` |
| `structuredAI(env.AI, model, input, { schema })` | `gateway.run(model, input, { responseFormat: { jsonSchema } })` |
| `aiWithTools(env.AI, model, input, { tools }, handler)` | `gateway.run(model, input, { toolOptions: { tools } })` + manual dispatch |

```ts
// Before
import { ai } from "@workkit/ai"
const client = ai(env.AI)
const result = await client.run("@cf/meta/llama-3.1-8b-instruct", { messages })

// After
import { createGateway } from "@workkit/ai-gateway"
const gateway = createGateway({
  providers: { ai: { type: "workers-ai", binding: env.AI } },
  defaultProvider: "ai",
})
const result = await gateway.run("@cf/meta/llama-3.1-8b-instruct", { messages })
```

`StructuredOutputError` and `estimateTokens` remain in `@workkit/ai` and aren't deprecated.

## Install

```bash
bun add @workkit/ai
```

## Usage

### Before (raw Workers AI)

```ts
// Untyped, no error handling, no retry, no fallback
const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "Hello" }],
}) // any — what shape is this?

// Streaming requires manual ReadableStream handling
// No fallback if a model is down
// No retry on transient failures
```

### After (workkit ai)

```ts
import { ai, streamAI, fallback, withRetry } from "@workkit/ai"

const client = ai(env.AI)

// Typed inference
const result = await client.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "Hello" }],
})
// result.data — typed output
// result.model — model that was used

// Streaming
const stream = streamAI(env.AI, "@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "Tell me a story" }],
})
return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })

// Fallback chain — try models in order
const response = await fallback(env.AI, {
  models: [
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
  ],
  input: { messages: [{ role: "user", content: "Hello" }] },
})

// Automatic retry with backoff
const retried = await withRetry(
  () => client.run("@cf/meta/llama-3.1-8b-instruct", { messages }),
  { maxRetries: 3, backoff: "exponential" },
)
```

## API

### Client

- **`ai(binding)`** — Create a typed AI client from `env.AI`
  - `.run(model, inputs, opts?)` — Run inference, returns `AiResult<T>`

### Streaming

- **`streamAI(binding, model, inputs, opts?)`** — Returns a `ReadableStream` for SSE

### Fallback

- **`fallback(binding, options)`** — Try models in order until one succeeds

### Retry

- **`withRetry(fn, options)`** — Retry with configurable backoff (`exponential`, `linear`, `fixed`)
- **`calculateDelay(attempt, options)`** — Calculate retry delay
- **`defaultIsRetryable(error)`** — Default retry eligibility check

### Utilities

- **`estimateTokens(text)`** — Rough token count estimation

## License

MIT
