---
title: "Rate Limiting"
---

# Rate Limiting

`@workkit/ratelimit` provides four KV-backed rate limiting strategies: fixed window, sliding window, token bucket, and composite. All return a uniform `RateLimitResult` and include helpers for HTTP headers and 429 responses.

## Fixed Window

Divides time into fixed-size windows. Each key gets a counter that resets at window boundaries:

```ts
import { fixedWindow } from '@workkit/ratelimit'

const limiter = fixedWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 100,          // max requests per window
  window: '1m',        // window duration
  prefix: 'rl:fw:',    // optional KV key prefix (default shown)
})

const result = await limiter.check('user:123')
// result.allowed    -- boolean
// result.remaining  -- requests left in window
// result.resetAt    -- Date when window resets
// result.limit      -- configured limit

if (!result.allowed) {
  return rateLimitResponse(result)
}
```

**Trade-offs**: Simple, one KV read + write per check. Can allow bursts at window boundaries (a user could make 100 requests at 0:59 and 100 at 1:01).

## Sliding Window

Approximates a true sliding window using a weighted average of the current and previous windows. More accurate than fixed window at the cost of an extra KV read:

```ts
import { slidingWindow } from '@workkit/ratelimit'

const limiter = slidingWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 100,
  window: '1m',
  prefix: 'rl:sw:',
})

const result = await limiter.check('user:123')
```

**How it works**: If 60 seconds have a 100-request limit, and the previous window had 80 requests, and we are 30 seconds into the current window, the weighted count is `80 * 0.5 (50% of previous window remaining) + current_count`. This smooths out the burst-at-boundary problem.

## Token Bucket

Tokens accumulate at a fixed rate up to a capacity. Each request consumes tokens. Allows burst traffic up to the bucket capacity:

```ts
import { tokenBucket } from '@workkit/ratelimit'

const limiter = tokenBucket({
  namespace: env.RATE_LIMIT_KV,
  capacity: 10,            // max tokens in bucket
  refillRate: 1,           // tokens added per interval
  refillInterval: '1s',    // how often tokens are added
  prefix: 'rl:tb:',
})

// Consume 1 token (default)
const result = await limiter.consume('user:123')

// Consume multiple tokens (for expensive operations)
const result = await limiter.consume('user:123', 5)
```

**Trade-offs**: Best for APIs where you want to allow bursts but enforce sustained rate. A bucket with capacity 10 and refill rate 1/s allows a burst of 10 requests, then 1/s sustained.

## Composite

Combine multiple limiters. All are checked in parallel; the most restrictive result is returned:

```ts
import { composite, fixedWindow, slidingWindow } from '@workkit/ratelimit'

const limiter = composite([
  // Per-minute limit
  fixedWindow({
    namespace: env.RATE_LIMIT_KV,
    limit: 60,
    window: '1m',
    prefix: 'rl:min:',
  }),
  // Per-hour limit
  fixedWindow({
    namespace: env.RATE_LIMIT_KV,
    limit: 1000,
    window: '1h',
    prefix: 'rl:hour:',
  }),
  // Per-day limit
  fixedWindow({
    namespace: env.RATE_LIMIT_KV,
    limit: 10000,
    window: '1d',
    prefix: 'rl:day:',
  }),
])

const result = await limiter.check('user:123')
// If ANY limiter blocks, allowed is false
// remaining is from the most restrictive limiter
```

## Duration Format

All strategies accept human-readable duration strings:

```ts
import { parseDuration } from '@workkit/ratelimit'

parseDuration('1s')    // 1000 ms
parseDuration('30s')   // 30000 ms
parseDuration('5m')    // 300000 ms
parseDuration('1h')    // 3600000 ms
parseDuration('1d')    // 86400000 ms
```

## HTTP Headers

Generate standard rate limit headers from any result:

```ts
import { rateLimitHeaders, rateLimitResponse } from '@workkit/ratelimit'

// Add headers to your response
const headers = rateLimitHeaders(result)
// {
//   'X-RateLimit-Limit': '100',
//   'X-RateLimit-Remaining': '42',
//   'X-RateLimit-Reset': '1711234567',
//   'Retry-After': '30'           // only present when blocked
// }

return new Response('OK', { headers: { ...headers } })
```

Generate a complete 429 response:

```ts
if (!result.allowed) {
  return rateLimitResponse(result)
  // 429 Too Many Requests
  // Content-Type: application/json
  // X-RateLimit-Limit: 100
  // X-RateLimit-Remaining: 0
  // X-RateLimit-Reset: 1711234567
  // Retry-After: 30
  // Body: {"error":"Rate limit exceeded","retryAfter":30}
}

// Custom message
return rateLimitResponse(result, 'Too many API calls')
```

## Pattern: Per-Endpoint Rate Limits

```ts
const apiLimiter = fixedWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 100,
  window: '1m',
})

const searchLimiter = fixedWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 10,
  window: '1m',
  prefix: 'rl:search:',
})

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'

    // Choose limiter based on endpoint
    const limiter = url.pathname.startsWith('/search') ? searchLimiter : apiLimiter
    const result = await limiter.check(ip)

    if (!result.allowed) {
      return rateLimitResponse(result)
    }

    // ... handle request
  },
}
```

## Pattern: User + IP Combined Key

```ts
const result = await limiter.check(`${userId}:${ip}`)
```

## Pattern: Tiered Limits

```ts
function getLimiter(plan: 'free' | 'pro' | 'enterprise') {
  const limits = { free: 100, pro: 1000, enterprise: 10000 }
  return fixedWindow({
    namespace: env.RATE_LIMIT_KV,
    limit: limits[plan],
    window: '1h',
    prefix: `rl:${plan}:`,
  })
}
```

## Consistency Note

All rate limiters use KV, which is eventually consistent. Under high concurrent load from multiple Workers instances, the actual limit may be briefly exceeded. This is suitable for most use cases. For strict mutual exclusion (e.g., financial transactions), use Durable Objects as the backing store instead.
