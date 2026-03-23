# @workkit/logger — Design Spec

## Goal

A structured logging library for Cloudflare Workers with the best DX in the ecosystem. Zero-config request context, automatic correlation IDs, Hono middleware with route exclusion, and standalone mode for queues/crons/DOs. Output is structured JSON that Workers Logs auto-indexes.

**The bar:** Better DX than Cloudflare's native `console.log` + Workers Logs dashboard. Developers should never need to think about logging plumbing — just call `log.info()` and everything is structured, correlated, and queryable.

## Design Principles

1. **Zero config to start** — `app.use(logger())` gives you structured request logging immediately
2. **Context travels with you** — AsyncLocalStorage means request context (requestId, path, method) is available anywhere without passing it
3. **Structured by default** — Every log is JSON. No string concatenation. Workers Logs auto-indexes JSON fields.
4. **Non-blocking** — Logging never delays the response. `waitUntil` for async operations.
5. **Tree-shakeable** — Import only what you use. Standalone logger has zero framework dependencies.
6. **Pino-inspired API** — Familiar API surface for Node.js developers. `log.info()`, `log.child()`, `log.warn()`.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Hono Middleware (logger())                      │
│  ┌────────────────────────────────────────────┐  │
│  │ 1. Generate requestId (or read from header)│  │
│  │ 2. Create AsyncLocalStorage context        │  │
│  │ 3. Log request start                       │  │
│  │ 4. Call next()                              │  │
│  │ 5. Log request complete with duration       │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Logger Core                                     │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Log Levels   │  │ Context (AsyncLocal)      │ │
│  │ debug < info │  │ requestId, method, path,  │ │
│  │ < warn < err │  │ startTime, custom fields  │ │
│  └──────────────┘  └──────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐│
│  │ Serializer                                    ││
│  │ Merges: base fields + context + call fields   ││
│  │ Output: JSON string → console[level]()        ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

## API Surface

### 1. Hono Middleware (Primary Entry Point)

```ts
import { logger } from '@workkit/logger'

const app = new Hono()

// Zero-config — logs all requests with structured JSON
app.use(logger())

// With options
app.use(logger({
  level: 'info',                          // minimum log level (default: 'info')
  exclude: ['/health', '/metrics'],       // routes to skip logging
  requestId: 'cf-ray',                    // header to use as requestId (default: auto-generate)
  fields: { service: 'api', version: '1.2.0' }, // base fields on every log
  timing: true,                           // log request duration (default: true)
}))
```

**What auto-logs on every request:**

```json
// Request start
{"level":"info","msg":"incoming request","requestId":"abc-123","method":"GET","path":"/users","ts":1711234567890}

// Request complete
{"level":"info","msg":"request complete","requestId":"abc-123","method":"GET","path":"/users","status":200,"duration":42,"ts":1711234567932}
```

### 2. In-Handler Logging (via Hono context)

```ts
import { getLogger } from '@workkit/logger'

app.get('/users/:id', async (c) => {
  const log = getLogger(c)

  log.info('fetching user')
  // → {"level":"info","msg":"fetching user","requestId":"abc-123","method":"GET","path":"/users/42","ts":...}

  log.warn('cache miss', { key: 'user:42' })
  // → {"level":"warn","msg":"cache miss","key":"user:42","requestId":"abc-123",...}

  log.error('db query failed', { error: err.message, table: 'users' })
  // → {"level":"error","msg":"db query failed","error":"connection refused","table":"users","requestId":"abc-123",...}

  // Child logger — adds persistent fields for a scope
  const userLog = log.child({ userId: c.req.param('id') })
  userLog.info('loaded profile')
  // → {"level":"info","msg":"loaded profile","userId":"42","requestId":"abc-123",...}

  return c.json(user)
})
```

### 3. Standalone Logger (Queues, Crons, DOs)

```ts
import { createLogger } from '@workkit/logger'

// For queue consumers
export default {
  async queue(batch, env) {
    const log = createLogger({ service: 'email-worker', level: 'debug' })

    log.info('processing batch', { count: batch.messages.length })

    for (const msg of batch.messages) {
      const msgLog = log.child({ messageId: msg.id })
      msgLog.debug('processing message', { body: msg.body })
      // ... process
      msgLog.info('message processed')
    }
  }
}

// For cron triggers
export default {
  async scheduled(event, env) {
    const log = createLogger({ service: 'cleanup-cron' })
    log.info('cron triggered', { cron: event.cron })
    // ...
  }
}
```

### 4. Log Levels

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
```

- `debug` — verbose development info, stripped in production by default
- `info` — normal operational messages
- `warn` — something unexpected but not broken
- `error` — something broke, needs attention

Setting level filters out everything below it. `level: 'warn'` means only `warn` and `error` are emitted.

### 5. Sensitive Data Redaction

```ts
app.use(logger({
  redact: ['authorization', 'cookie', 'x-api-key'],  // header names to redact
}))

// Or custom redactor
app.use(logger({
  redact: (key, value) => {
    if (key === 'password') return '[REDACTED]'
    if (key === 'ssn') return '[REDACTED]'
    return value
  }
}))
```

## File Structure

```
packages/logger/
  src/
    index.ts          — Public exports
    logger.ts         — Core Logger class (createLogger, log levels, child)
    context.ts        — AsyncLocalStorage context management
    middleware.ts      — Hono middleware (logger(), getLogger())
    serializer.ts     — JSON serialization with field merging
    levels.ts         — Log level definitions and filtering
    types.ts          — TypeScript interfaces
  tests/
    logger.test.ts
    context.test.ts
    middleware.test.ts
    serializer.test.ts
    levels.test.ts
  package.json
  tsconfig.json
  bunup.config.ts
```

## Output Format

Every log entry is a single JSON line:

```json
{
  "level": "info",
  "msg": "fetching user",
  "ts": 1711234567890,
  "requestId": "abc-123",
  "method": "GET",
  "path": "/users/42",
  "service": "api",
  "userId": "42",
  "duration": 42
}
```

**Field priority (last wins on conflict):**
1. Base fields (from `createLogger` or middleware `fields` option)
2. Context fields (requestId, method, path — from AsyncLocalStorage)
3. Child fields (from `log.child()`)
4. Call fields (from `log.info('msg', { ...fields })`)

## DX Advantages Over Cloudflare Native

| Feature | Cloudflare Native | @workkit/logger |
|---------|------------------|-----------------|
| Setup | Manual console.log | `app.use(logger())` — one line |
| Structure | You build JSON yourself | Automatic structured JSON |
| Request ID | Manual generation + passing | Auto-generated, travels via AsyncLocalStorage |
| Correlation | None built-in | Automatic per-request |
| Log levels | None (everything is console.log) | debug/info/warn/error with filtering |
| Duration | Manual Date.now() math | Auto-timed on every request |
| Child context | Not possible | `log.child({ userId })` |
| Redaction | Manual | Declarative redact config |
| Route exclusion | Not possible | `exclude: ['/health']` |
| Type safety | console.log accepts anything | Typed fields, typed levels |

## Dependencies

- `hono` — peerDependency (only needed for middleware, not standalone logger)
- `@workkit/types` — devDependency only (for shared types if needed)
- Zero runtime dependencies

## Edge Cases

- **AsyncLocalStorage not available**: Falls back to a simple logger without request context. No crash.
- **Circular references in fields**: Serializer handles gracefully with `[Circular]` placeholder.
- **Very large field values**: Truncated at 1KB per field value to prevent log bloat.
- **Error objects**: Auto-serialized to `{ message, stack, name }`.
- **Undefined/null fields**: Omitted from output (no `"field": null` noise).

## Testing Strategy

- Unit tests for each module (logger, context, serializer, middleware, levels)
- Integration test: full Hono app with middleware → verify structured output
- Edge case tests: circular refs, large values, missing AsyncLocalStorage
- Type tests: verify TypeScript inference works correctly
