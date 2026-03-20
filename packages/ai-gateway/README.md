# @workkit/ai-gateway

> Multi-provider AI gateway with routing, cost tracking, caching, and logging

[![npm](https://img.shields.io/npm/v/@workkit/ai-gateway)](https://www.npmjs.com/package/@workkit/ai-gateway)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/ai-gateway)](https://bundlephobia.com/package/@workkit/ai-gateway)

## Install

```bash
bun add @workkit/ai-gateway
```

## Usage

### Before (manual multi-provider setup)

```ts
// Hand-rolled provider switching, no cost tracking, no caching
async function runAI(prompt: string) {
  try {
    return await callOpenAI(prompt)
  } catch {
    try {
      return await callAnthropic(prompt)
    } catch {
      return await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages })
    }
  }
  // No usage tracking, no cost awareness, no response caching
}
```

### After (workkit ai-gateway)

```ts
import { createGateway, createRouter, createCostTracker, withCache, withLogging } from "@workkit/ai-gateway"

// Multi-provider gateway
const gateway = createGateway({
  providers: {
    openai: { type: "openai", apiKey: env.OPENAI_KEY },
    anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
    workers: { type: "workers-ai", binding: env.AI },
  },
  defaultProvider: "workers",
})

const result = await gateway.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "Hello" }],
})
// result.text, result.usage, result.provider, result.model

// Smart routing — route by model, cost, or custom logic
const router = createRouter({
  routes: [
    { match: /^gpt-/, provider: "openai" },
    { match: /^claude-/, provider: "anthropic" },
    { match: /^@cf\//, provider: "workers" },
  ],
})

// Cost tracking with budgets
const costs = createCostTracker({
  storage: env.COST_KV,
  budget: { daily: 10.0 },
  pricing: { "gpt-4o": { input: 2.5, output: 10.0 } },
})

// Add caching and logging as middleware
const enhanced = withLogging(withCache(gateway, { storage: caches }), {
  onRequest: (req) => console.log("AI request:", req.model),
})
```

## API

### Gateway

- **`createGateway(config)`** — Multi-provider AI gateway
  - `.run(model, input, opts?)` — Run inference through configured providers

### Router

- **`createRouter(config)`** — Route requests to providers by model pattern or custom logic

### Cost Tracking

- **`createCostTracker(config)`** — Track token usage and costs per model
  - `.record(usage)`, `.getSummary()`, `.checkBudget()`

### Middleware

- **`withCache(gateway, config)`** — Cache AI responses
- **`withLogging(gateway, config)`** — Log requests and responses

### Provider Types

- `workers-ai` — Cloudflare Workers AI (uses binding)
- `openai` — OpenAI-compatible APIs (configurable base URL)
- `anthropic` — Anthropic Claude API
- `custom` — Any provider with a custom handler

## License

MIT
