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

### Helpers

- **`getEnv(c)`** — Get validated env from Hono context (shorthand for `c.get("workkit:env")`)

## License

MIT
