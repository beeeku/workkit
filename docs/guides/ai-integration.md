# AI Integration

workkit provides two packages for AI: `@workkit/ai` for Workers AI (Cloudflare's built-in models) and `@workkit/ai-gateway` for multi-provider AI routing (Workers AI, OpenAI, Anthropic, custom providers) with cost tracking, caching, and logging.

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

## Full Example: AI-Powered API

```ts
import { ai, streamAI, fallback } from '@workkit/ai'
import { createGateway, createCostTracker } from '@workkit/ai-gateway'
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

    const url = new URL(request.url)
    const body = await request.json() as { prompt: string; stream?: boolean }

    // Streaming endpoint
    if (body.stream) {
      const stream = await streamAI(env.AI, '@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: body.prompt }],
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    // Non-streaming with fallback
    const result = await fallback(env.AI, [
      { model: '@cf/meta/llama-3.1-70b-instruct', timeout: 5000 },
      { model: '@cf/meta/llama-3.1-8b-instruct', timeout: 10000 },
    ], {
      messages: [{ role: 'user', content: body.prompt }],
    })

    return Response.json({
      response: result.data,
      model: result.model,
      attempts: result.attempts,
    })
  },
}
```
