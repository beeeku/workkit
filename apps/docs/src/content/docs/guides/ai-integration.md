---
title: "AI Integration"
---

# AI Integration

workkit provides two packages for AI:

- **`@workkit/ai-gateway`** (recommended) — multi-provider gateway covering Workers AI, OpenAI, Anthropic, and custom providers. Unified streaming, retry, fallback, prompt caching, routing, cost tracking, logging, and Cloudflare AI Gateway support.
- **`@workkit/ai`** — thin Workers-AI-only client, predates the gateway. Slated to become a deprecation shim over `@workkit/ai-gateway` per [ADR-001](https://github.com/beeeku/workkit/blob/master/.maina/decisions/001-ai-package-consolidation.md); new code should start with `@workkit/ai-gateway`.

## Workers AI (`@workkit/ai`)

### Basic Usage

```ts
import { ai } from '@workkit/ai'

const client = ai(env.AI)

const result = await client.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
})

console.log(result.data)   // model output
console.log(result.model)  // '@cf/meta/llama-3.1-8b-instruct'
```

### Streaming

Stream text generation responses as Server-Sent Events:

```ts
import { streamAI } from '@workkit/ai'

export default {
  async fetch(request: Request, env: Env) {
    const stream = await streamAI(
      env.AI,
      '@cf/meta/llama-3.1-8b-instruct',
      {
        messages: [{ role: 'user', content: 'Write a haiku about Cloudflare' }],
      },
      {
        timeout: 30000,  // 30 second timeout
      },
    )

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  },
}
```

The `stream` flag is set automatically. The returned `ReadableStream<Uint8Array>` can be passed directly to a `Response`. If a timeout is set, the stream is automatically cancelled when it expires.

### Fallback Chains

Try multiple models in order, automatically falling back on failure or timeout:

```ts
import { fallback } from '@workkit/ai'

const result = await fallback(
  env.AI,
  [
    { model: '@cf/meta/llama-3.1-70b-instruct', timeout: 5000 },
    { model: '@cf/meta/llama-3.1-8b-instruct', timeout: 10000 },
    { model: '@cf/mistral/mistral-7b-instruct-v0.2' },
  ],
  {
    messages: [{ role: 'user', content: 'Hello' }],
  },
  {
    onFallback: (failedModel, error, nextModel) => {
      console.log(`${failedModel} failed, trying ${nextModel}`)
    },
  },
)

console.log(result.data)       // output from whichever model succeeded
console.log(result.model)      // which model responded
console.log(result.attempted)  // ['@cf/meta/llama-3.1-70b-instruct', ...]
console.log(result.attempts)   // number of models tried
```

If all models fail, a `ServiceUnavailableError` is thrown listing all attempted models.

### Retry

Wrap any AI call with retry logic:

```ts
import { withRetry } from '@workkit/ai'

const result = await withRetry(
  () => client.run('@cf/meta/llama-3.1-8b-instruct', { messages }),
  {
    maxRetries: 3,
    backoff: 'exponential',  // 'fixed' | 'exponential'
    baseDelay: 1000,
    maxDelay: 10000,
    isRetryable: (error) => {
      // Custom retry predicate (optional)
      return error instanceof ServiceUnavailableError
    },
  },
)
```

### Token Estimation

Estimate token count for input text (useful for cost budgeting):

```ts
import { estimateTokens } from '@workkit/ai'

const count = estimateTokens('Hello, how are you?')
// Approximate token count
```

## AI Gateway (`@workkit/ai-gateway`)

The gateway provides a unified interface across multiple AI providers with routing, cost tracking, caching, and logging.

### Creating a Gateway

```ts
import { createGateway } from '@workkit/ai-gateway'

const gateway = createGateway({
  providers: {
    'workers-ai': {
      type: 'workers-ai',
      binding: env.AI,
    },
    'openai': {
      type: 'openai',
      apiKey: env.OPENAI_KEY,
      baseUrl: 'https://api.openai.com/v1',  // default
    },
    'anthropic': {
      type: 'anthropic',
      apiKey: env.ANTHROPIC_KEY,
      baseUrl: 'https://api.anthropic.com/v1',  // default
    },
    'local-llm': {
      type: 'custom',
      run: async (model, input) => {
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          body: JSON.stringify({ model, ...input }),
        })
        const raw = await response.json()
        return { text: raw.message.content, raw, provider: 'local-llm', model }
      },
    },
  },
  defaultProvider: 'workers-ai',
})
```

### Running Inference

```ts
// Use default provider
const result = await gateway.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [{ role: 'user', content: 'Hello' }],
})

// Specify provider
const result = await gateway.run('gpt-4', {
  messages: [{ role: 'user', content: 'Hello' }],
}, {
  provider: 'openai',
  timeout: 10000,
})

// Result shape
console.log(result.text)       // extracted text response
console.log(result.raw)        // raw provider response
console.log(result.usage)      // { inputTokens, outputTokens } if available
console.log(result.provider)   // 'openai'
console.log(result.model)      // 'gpt-4'
```

### Routing

Map model names to providers automatically:

```ts
import { createRouter } from '@workkit/ai-gateway'

const router = createRouter({
  routes: [
    { pattern: /^gpt-/, provider: 'openai' },
    { pattern: /^claude-/, provider: 'anthropic' },
    { pattern: /^@cf\//, provider: 'workers-ai' },
    { pattern: /.*/, provider: 'workers-ai' },  // catch-all
  ],
})

const provider = router.resolve('gpt-4')        // 'openai'
const provider = router.resolve('claude-3')      // 'anthropic'
const provider = router.resolve('@cf/meta/...')  // 'workers-ai'
```

### Cost Tracking

Track token usage and cost across models:

```ts
import { createCostTracker } from '@workkit/ai-gateway'

const costs = createCostTracker({
  pricing: {
    // Prices per 1K tokens
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
  },
})

// Record usage after each call
if (result.usage) {
  costs.record(result.model, result.usage)
}

// Get totals
const summary = costs.getTotal()
console.log(summary.totalCost)                          // total USD
console.log(summary.byModel['gpt-4'].inputCost)        // input cost for gpt-4
console.log(summary.byModel['gpt-4'].outputCost)       // output cost for gpt-4
console.log(summary.byModel['gpt-4'].requests)         // number of requests
console.log(summary.byModel['gpt-4'].inputTokens)      // total input tokens
console.log(summary.byModel['gpt-4'].outputTokens)     // total output tokens

// Budget checking
const check = costs.checkBudget(10.00)  // $10 budget
console.log(check.exceeded)     // boolean
console.log(check.remaining)    // USD remaining
console.log(check.totalSpent)   // USD spent

// Reset counters
costs.reset()
```

### Caching

Wrap the gateway with caching to avoid duplicate requests:

```ts
import { createGateway, withCache } from '@workkit/ai-gateway'

const cachedGateway = withCache(gateway, {
  storage: env.AI_CACHE_KV,   // KV namespace for cache
  ttl: 3600,                  // cache for 1 hour
})

// Same inputs = cached response (no API call)
const result1 = await cachedGateway.run('gpt-4', { messages })
const result2 = await cachedGateway.run('gpt-4', { messages })  // cache hit
```

### Logging

Wrap the gateway with request/response logging:

```ts
import { createGateway, withLogging } from '@workkit/ai-gateway'

const loggedGateway = withLogging(gateway, {
  onRequest: (model, input, options) => {
    console.log(`AI request: ${model}`, input)
  },
  onResponse: (output, durationMs) => {
    console.log(`AI response in ${durationMs}ms from ${output.provider}`)
  },
  onError: (error, model) => {
    console.error(`AI error for ${model}:`, error)
  },
})
```

### Retry

Wrap the gateway with automatic retry on retryable errors. Delay between attempts is driven by each thrown `WorkkitError`'s own `retryStrategy` from `@workkit/errors` — no delay config needed. Per-call `AbortSignal` aborts the retry loop.

```ts
import { withRetry } from '@workkit/ai-gateway'

const resilient = withRetry(gateway, { maxAttempts: 3 })
await resilient.run('claude-sonnet-4-6', { prompt: '…' })
```

`ServiceUnavailableError`, `TimeoutError`, and `RateLimitError` are retryable by default. A custom `isRetryable` hook overrides the default:

```ts
withRetry(gateway, {
  maxAttempts: 5,
  isRetryable: (err) => /* your logic */,
})
```

### Cloudflare AI Gateway

Route OpenAI and Anthropic traffic through your [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) for centralized caching, logs, cost dashboards, and rate-limiting. Calls go to `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/{provider}/…` and `cf-aig-*` headers are injected automatically.

```ts
createGateway({
  providers: {
    anthropic: { type: 'anthropic', apiKey: env.ANTHROPIC_KEY },
    openai:    { type: 'openai',    apiKey: env.OPENAI_KEY },
  },
  cfGateway: {
    accountId: env.CF_ACCOUNT_ID,
    gatewayId: 'my-gateway',
    authToken: env.CF_AIG_TOKEN,  // → cf-aig-authorization (optional)
    cacheTtl: 3600,                // → cf-aig-cache-ttl (optional)
    skipCache: true,               // → cf-aig-skip-cache (only when true)
  },
  defaultProvider: 'anthropic',
})
```

Explicit `baseUrl` on a provider config overrides `cfGateway`. Workers AI and custom providers are unaffected.

### Server-side fallback (CF Universal Endpoint)

`runFallback` POSTs a provider chain to the [CF Universal Endpoint](https://developers.cloudflare.com/ai-gateway/configuration/universal-endpoint/). Cloudflare tries each entry server-side in order and returns the first success. Requires `cfGateway`.

```ts
// runFallback is an optional Gateway method — use `!` when you constructed
// the gateway yourself via createGateway (which always implements it).
const result = await gateway.runFallback!(
  [
    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { provider: 'openai',    model: 'gpt-4o' },
  ],
  { messages: [{ role: 'user', content: 'hi' }] },
)
// result.provider identifies which one served the response
```

Only `openai` and `anthropic` entries are supported. The provider of the successful response is identified by config type, so custom provider key names (e.g. `'claude'`, `'gpt'`) work correctly.

### Anthropic prompt caching

Mark long-lived context with `cacheControl: 'ephemeral'` — it becomes a [prompt-cached content block](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching). Cheaper and faster on repeat calls. Non-Anthropic providers silently ignore the flag.

```ts
await gateway.run('claude-sonnet-4-6', {
  messages: [
    { role: 'system', content: longDocument, cacheControl: 'ephemeral' },
    { role: 'user',   content: 'summarize this' },
  ],
})
```

### Streaming

`gateway.stream()` returns a typed `ReadableStream<GatewayStreamEvent>`:

```ts
type GatewayStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; usage?: TokenUsage; raw?: unknown }
```

Successful streams end with exactly one `done` event. Mid-stream errors reject `read()` without enqueuing a synthetic `done`. Supported across Workers AI, Anthropic SSE, and OpenAI SSE. Tool-use events are emitted when the model completes a tool call mid-stream (Anthropic `input_json_delta` accumulation; OpenAI `tool_calls` delta accumulation).

```ts
// stream is an optional Gateway method — use `!` when the gateway was built
// via createGateway (which always implements it).
const stream = await gateway.stream!('claude-sonnet-4-6', {
  messages: [{ role: 'user', content: 'explain quantum tunneling' }],
})

const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  if (value.type === 'text') process.stdout.write(value.delta)
  if (value.type === 'tool_use') await handleToolCall(value)
  if (value.type === 'done') console.log('usage:', value.usage)
}
```

Consumer `reader.cancel()` propagates to the upstream fetch, so you stop paying for tokens you're not reading.

## Full Example: AI-Powered API

```ts
import { createGateway, withRetry, withLogging } from '@workkit/ai-gateway'
import { fixedWindow, rateLimitResponse } from '@workkit/ratelimit'

export default {
  async fetch(request: Request, env: Env) {
    // Rate limit AI requests
    const limiter = fixedWindow({
      namespace: env.RATE_LIMIT_KV,
      limit: 50,
      window: '1h',
    })
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const rl = await limiter.check(`ai:${ip}`)
    if (!rl.allowed) return rateLimitResponse(rl)

    const body = await request.json() as { prompt: string; stream?: boolean }

    const gateway = withRetry(withLogging(
      createGateway({
        providers: {
          anthropic: { type: 'anthropic', apiKey: env.ANTHROPIC_KEY },
          openai:    { type: 'openai',    apiKey: env.OPENAI_KEY },
          workers:   { type: 'workers-ai', binding: env.AI },
        },
        // Route HTTP providers through CF AI Gateway for caching + observability
        cfGateway: { accountId: env.CF_ACCOUNT_ID, gatewayId: 'prod-gw' },
        defaultProvider: 'anthropic',
      }),
      { onError: (model, err) => console.error(`AI error: ${model}`, err) },
    ), { maxAttempts: 3 })

    // Streaming endpoint — typed events across providers.
    // JSON-encode each event so embedded newlines and tool_use blocks survive
    // SSE framing; the browser-side parser decodes one JSON payload per event.
    if (body.stream) {
      const events = await gateway.stream!('claude-sonnet-4-6', {
        messages: [{ role: 'user', content: body.prompt }],
      })
      const encoder = new TextEncoder()
      return new Response(
        events.pipeThrough(new TransformStream({
          transform(evt, ctrl) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
            if (evt.type === 'done') ctrl.enqueue(encoder.encode('data: [DONE]\n\n'))
          },
        })),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }

    // Non-streaming with server-side fallback: CF tries Anthropic, then OpenAI
    const result = await gateway.runFallback!(
      [
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        { provider: 'openai',    model: 'gpt-4o' },
      ],
      { messages: [{ role: 'user', content: body.prompt }] },
    )

    return Response.json({
      response: result.text,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    })
  },
}
```

## See also

- [Agents](/workkit/guides/agents/) — `@workkit/agent` builds agent loops on top of `@workkit/ai-gateway`.
- [Agent Memory](/workkit/guides/agent-memory/) — `@workkit/memory` uses Workers AI for embeddings and exposes recall results you can inject into prompts.
- [MCP Servers](/workkit/guides/mcp-servers/) — surface your tools to MCP clients.
