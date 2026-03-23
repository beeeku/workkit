# @workkit/hono

> Hono middleware for env validation, error handling, rate limiting, and caching

[![npm](https://img.shields.io/npm/v/@workkit/hono)](https://www.npmjs.com/package/@workkit/hono)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/hono)](https://bundlephobia.com/package/@workkit/hono)

## Install

```bash
bun add @workkit/hono hono
```

## Usage

### Before (manual Hono setup)

```ts
import { Hono } from "hono"

const app = new Hono()

app.use("*", async (c, next) => {
  // Manual env validation on every request
  if (!c.env.API_KEY) return c.text("Missing API_KEY", 500)
  await next()
})

app.onError((err, c) => {
  // Generic error handling — lose structured error info
  return c.json({ error: err.message }, 500)
})
```

### After (workkit hono)

```ts
import { Hono } from "hono"
import { workkit, workkitErrorHandler, rateLimit, cacheResponse } from "@workkit/hono"
import { z } from "zod"

const app = new Hono()

// Validate env on first request — typed and cached
app.use(workkit({ env: { API_KEY: z.string().min(1), DB: z.any() } }))

// Structured error handling — WorkkitErrors become proper JSON responses
app.onError(workkitErrorHandler())

// KV-backed rate limiting
app.use("/api/*", rateLimit({ limit: 100, window: "1m" }))

// Response caching
app.use("/api/public/*", cacheResponse({ ttl: 300 }))

app.get("/", (c) => {
  const env = c.get("workkit:env") // fully typed
  return c.json({ key: env.API_KEY })
})
```

## API

### Middleware

- **`workkit(options)`** — Validate environment bindings. Stores typed env in `c.get("workkit:env")`.

### Error Handling

- **`workkitErrorHandler(options?)`** — Convert `WorkkitError` instances to structured JSON responses with proper status codes.

### Rate Limiting

- **`rateLimit(options)`** — KV-backed rate limiting middleware. Options: `limit`, `window`, `keyFn?`
- **`fixedWindow(options)`** — Fixed window rate limiter (lower-level)

### Caching

- **`cacheResponse(options)`** — Cache responses using the Cache API. Options: `ttl`, `vary?`

### Tiered Rate Limiting

- **`tieredRateLimit(options)`** — Apply different rate limits based on user tier. Uses `@workkit/ratelimit` tiered limiter under the hood.

```ts
app.use("/api/*", tieredRateLimit({
  namespace: env.RATE_LIMIT_KV,
  tiers: { free: { limit: 100 }, pro: { limit: 10000 } },
  window: "1h",
  keyFn: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
  tierFn: (c) => getUserTier(c),
}))
```

### Quota Middleware

- **`quotaLimit(options)`** — Enforce multi-window quota limits (e.g. 10/hour + 100/day). Returns 429 with quota breakdown when exceeded.

```ts
app.use("/api/*", quotaLimit({
  namespace: env.RATE_LIMIT_KV,
  limits: [
    { window: "1h", limit: 10 },
    { window: "1d", limit: 100 },
  ],
  keyFn: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
}))
```

### Cache Jitter

The `cacheResponse` middleware supports a `jitter` option to randomize TTL per response, preventing thundering herd when many cache entries expire simultaneously:

```ts
app.use("/api/public/*", cacheResponse({ ttl: 300, jitter: 30 }))
// Actual TTL will be 270-330s (±30s random offset)
```

### Helpers

- **`getEnv(c)`** — Get validated env from Hono context (shorthand for `c.get("workkit:env")`)

## License

MIT
