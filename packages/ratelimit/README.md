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

## License

MIT
