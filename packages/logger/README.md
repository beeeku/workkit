# @workkit/logger

> Structured logging for Cloudflare Workers with automatic request context and Hono middleware

[![npm](https://img.shields.io/npm/v/@workkit/logger)](https://www.npmjs.com/package/@workkit/logger)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/logger)](https://bundlephobia.com/package/@workkit/logger)

## Install

```bash
bun add @workkit/logger
```

## Usage

### Before (raw console.log)

```ts
// No structure, no levels, no request context
console.log("processing request", request.url)
console.log("user found", JSON.stringify(user))
console.error("something failed", error.message)
```

### After (workkit logger)

```ts
import { createLogger } from "@workkit/logger"

const log = createLogger({ service: "api", level: "debug" })
log.info("processing request", { url: request.url })
log.info("user found", { userId: user.id })
log.error("something failed", { error })
// {"level":"info","msg":"processing request","ts":1234567890,"service":"api","url":"/users"}
```

### Hono Middleware

```ts
import { Hono } from "hono"
import { logger, getLogger } from "@workkit/logger"

const app = new Hono()

// Auto-logs request start/complete with timing and requestId
app.use(logger({ exclude: ["/health"], fields: { service: "api" } }))

app.get("/users", (c) => {
  const log = getLogger(c)
  log.info("fetching users", { count: 50 })
  return c.json(users)
})
```

### Child Loggers

```ts
const log = createLogger({ service: "worker" })
const batchLog = log.child({ batchId: "abc-123" })

batchLog.info("processing item", { itemId: 1 })
// {"level":"info","msg":"processing item","ts":...,"service":"worker","batchId":"abc-123","itemId":1}
```

### Redaction

```ts
app.use(
  logger({
    redact: ["authorization", "cookie", "x-api-key"],
  }),
)
// Fields matching redacted keys are replaced with "[REDACTED]"

// Or use a custom redactor function
app.use(
  logger({
    redact: (key, value) =>
      key.toLowerCase().includes("secret") ? "[REDACTED]" : value,
  }),
)
```

### Request Context (AsyncLocalStorage)

```ts
import { getRequestContext } from "@workkit/logger"

// Inside a request handled by the logger middleware:
const ctx = getRequestContext()
if (ctx) {
  console.log(ctx.requestId) // "a1b2c3d4e5f67890"
  console.log(ctx.method) // "GET"
  console.log(ctx.path) // "/users"
}
```

## API

### Standalone Logger

- **`createLogger(options?)`** -- Create a structured logger
  - `options.level` -- Minimum log level (`"debug"`, `"info"`, `"warn"`, `"error"`). Default: `"info"`
  - `options.fields` -- Base fields attached to every log entry
  - Returns `Logger` with `.debug()`, `.info()`, `.warn()`, `.error()`, `.child()`

### Hono Middleware

- **`logger(options?)`** -- Hono middleware for structured request logging
  - `options.level` -- Minimum log level. Default: `"info"`
  - `options.exclude` -- Routes to skip (exact match or prefix)
  - `options.requestId` -- Header name to use as requestId (default: auto-generate)
  - `options.fields` -- Base fields on every entry
  - `options.timing` -- Auto-log request duration. Default: `true`
  - `options.redact` -- Field names or custom function for redacting sensitive data

- **`getLogger(c)`** -- Get a logger from Hono context (includes requestId, method, path)

### Request Context

- **`getRequestContext()`** -- Get the current request context from AsyncLocalStorage

### Types

- **`LogLevel`** -- `"debug" | "info" | "warn" | "error"`
- **`LogFields`** -- `Record<string, unknown>`
- **`LogEntry`** -- `{ level, msg, ts, ...fields }`
- **`Logger`** -- Logger interface with level methods and `.child()`
- **`RequestContext`** -- `{ requestId, method, path, startTime, fields }`

## License

MIT
