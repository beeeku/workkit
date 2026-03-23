# @workkit/ratelimit

> KV-backed rate limiting with fixed window, sliding window, and token bucket algorithms

[![npm](https://img.shields.io/npm/v/@workkit/ratelimit)](https://www.npmjs.com/package/@workkit/ratelimit)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/ratelimit)](https://bundlephobia.com/package/@workkit/ratelimit)

## Install

```bash
bun add @workkit/ratelimit
```

## Usage

### Before (manual rate limiting)

```ts
// DIY rate limiting with KV — error-prone, no standard headers
const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`
const count = parseInt((await env.RL_KV.get(key)) ?? "0")
if (count >= 100) {
  return new Response("Too many requests", { status: 429 })
}
await env.RL_KV.put(key, String(count + 1), { expirationTtl: 120 })
```

### After (workkit ratelimit)

```ts
import { fixedWindow, slidingWindow, tokenBucket, rateLimitHeaders } from "@workkit/ratelimit"

// Fixed window — simple and efficient
const limiter = fixedWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 100,
  window: "1m",
})

const result = await limiter.check(`user:${userId}`)
if (!result.allowed) {
  return new Response("Too many requests", {
    status: 429,
    headers: rateLimitHeaders(result), // X-RateLimit-Limit, Remaining, Reset
  })
}

// Sliding window — smoother distribution
const slidingLimiter = slidingWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 1000,
  window: "1h",
})

// Token bucket — burst-friendly
const bucketLimiter = tokenBucket({
  namespace: env.RATE_LIMIT_KV,
  capacity: 50,
  refillRate: 10,
  refillInterval: "1m",
})
```

## API

### Rate Limiters

- **`fixedWindow(options)`** — Fixed window counter. Options: `namespace`, `limit`, `window`, `prefix?`
- **`slidingWindow(options)`** — Sliding window counter for smoother rate limiting
- **`tokenBucket(options)`** — Token bucket with configurable refill rate and burst capacity
- **`composite(limiters)`** — Combine multiple limiters (all must allow)

Each returns a `RateLimiter` with:
- `.check(key)` — Returns `{ allowed, remaining, resetAt, limit }`

### Utilities

- **`rateLimitHeaders(result)`** — Generate standard `X-RateLimit-*` headers
- **`rateLimitResponse(result)`** — Generate a 429 `Response` with headers
- **`parseDuration(str)`** — Parse `"1m"`, `"1h"`, `"30s"` to milliseconds

### Tiered Rate Limiting

- **`tiered(options)`** — Create a tiered rate limiter with per-plan limits. Each tier gets its own limit and underlying limiter instance. Tiers with `Number.POSITIVE_INFINITY` short-circuit without touching KV. Supports `"fixed"` (default) or `"sliding"` algorithm.
  - `.check(key, tier)` — Check rate limit for a key at a specific tier
  - `.forTier(tier)` — Get a standalone `RateLimiter` bound to a tier

```ts
import { tiered } from "@workkit/ratelimit"

const limiter = tiered({
  namespace: env.RATE_LIMIT_KV,
  tiers: { free: { limit: 100 }, pro: { limit: 10000 }, enterprise: { limit: Infinity } },
  window: "1h",
  defaultTier: "free",
})
const result = await limiter.check(`user:${userId}`, userPlan) // "free" | "pro" | "enterprise"
```

### Quota Buckets

- **`quota(options)`** — Calendar-aligned usage tracking with multiple concurrent windows. Requests are only counted if ALL windows allow them. Supports variable cost per request.
  - `.check(key, cost?)` — Check and consume quota (cost defaults to 1). Returns `{ allowed, remaining, resetAt, limit, quotas }`.
  - `.usage(key)` — Read-only usage query across all windows

```ts
import { quota } from "@workkit/ratelimit"

const q = quota({
  namespace: env.RATE_LIMIT_KV,
  limits: [
    { window: "1h", limit: 100 },
    { window: "1d", limit: 1000 },
  ],
})
const result = await q.check("user:123", 5) // cost of 5 units
const usage = await q.usage("user:123")      // read-only, no consumption
```

## License

MIT
