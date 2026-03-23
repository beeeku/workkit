# Logging

`@workkit/logger` provides structured JSON logging for Cloudflare Workers. It ships a standalone logger for use anywhere and a Hono middleware that automatically tracks request context, timing, and request IDs. Every log entry is JSON -- ready for Logpush, Datadog, or any structured log pipeline.

## Quick Start

### Standalone Logger

Use `createLogger` in queue consumers, cron handlers, Durable Objects, or any non-Hono context:

```ts
import { createLogger } from '@workkit/logger'

const log = createLogger({ level: 'debug', fields: { service: 'email-worker' } })

log.info('batch started', { count: 50 })
log.debug('processing item', { itemId: 'abc' })
log.warn('slow item', { itemId: 'xyz', duration: 4500 })
log.error('item failed', { itemId: 'def', error: new Error('timeout') })
```

Output (one JSON object per line):

```json
{"level":"info","msg":"batch started","ts":1711234567890,"service":"email-worker","count":50}
{"level":"debug","msg":"processing item","ts":1711234567891,"service":"email-worker","itemId":"abc"}
```

### Hono Middleware

For Hono apps, the `logger()` middleware auto-logs every request with timing and a unique requestId:

```ts
import { Hono } from 'hono'
import { logger, getLogger } from '@workkit/logger'

const app = new Hono()

app.use(logger({
  level: 'info',
  fields: { service: 'api' },
  exclude: ['/health', '/ready'],
}))

app.get('/users', (c) => {
  const log = getLogger(c)
  log.info('fetching users')
  return c.json({ users: [] })
})

export default app
```

Each request automatically produces two log entries:

```json
{"level":"info","msg":"incoming request","ts":...,"requestId":"a1b2c3d4e5f67890","method":"GET","path":"/users"}
{"level":"info","msg":"request complete","ts":...,"requestId":"a1b2c3d4e5f67890","method":"GET","path":"/users","status":200,"duration":12}
```

## Log Levels

Four levels in order of severity:

| Level | Numeric | Use For |
|-------|---------|---------|
| `debug` | 10 | Development details, verbose tracing |
| `info` | 20 | Normal operation events |
| `warn` | 30 | Unusual conditions, degraded performance |
| `error` | 40 | Failures requiring attention |

Set the minimum level to filter output:

```ts
const log = createLogger({ level: 'warn' })
log.debug('ignored')  // not emitted
log.info('ignored')   // not emitted
log.warn('emitted')   // emitted
log.error('emitted')  // emitted
```

## Child Loggers

Create child loggers that inherit parent fields and add their own. Useful for adding context within a loop or nested function:

```ts
const log = createLogger({ fields: { service: 'batch-worker' } })

async function processBatch(batchId: string, items: Item[]) {
  const batchLog = log.child({ batchId })

  for (const item of items) {
    const itemLog = batchLog.child({ itemId: item.id })
    itemLog.info('processing')
    // {"level":"info","msg":"processing","ts":...,"service":"batch-worker","batchId":"abc","itemId":"123"}

    try {
      await process(item)
      itemLog.info('done')
    } catch (error) {
      itemLog.error('failed', { error })
    }
  }
}
```

Child loggers are cheap -- they share the parent's level and merge fields at call time.

## Redaction

Prevent sensitive data from leaking into logs.

### Field Name Redaction

Pass an array of field names to replace with `[REDACTED]`:

```ts
app.use(logger({
  redact: ['authorization', 'cookie', 'x-api-key', 'password'],
}))

// log.info('auth check', { authorization: 'Bearer sk-...' })
// Output: {"level":"info","msg":"auth check","ts":...,"authorization":"[REDACTED]"}
```

### Custom Redactor

Pass a function for more control:

```ts
app.use(logger({
  redact: (key, value) => {
    if (key.toLowerCase().includes('secret')) return '[REDACTED]'
    if (key === 'email' && typeof value === 'string') {
      return value.replace(/(.{2}).*(@.*)/, '$1***$2')
    }
    return value
  },
}))
```

## Request Context

The middleware stores request context in AsyncLocalStorage. Any code called within a request can access it without passing the logger through function arguments:

```ts
import { getRequestContext } from '@workkit/logger'

function logAuditEvent(action: string) {
  const ctx = getRequestContext()
  if (ctx) {
    console.log(JSON.stringify({
      action,
      requestId: ctx.requestId,
      method: ctx.method,
      path: ctx.path,
    }))
  }
}
```

This is useful for libraries or utility functions that need request context but don't have access to the Hono `Context` object.

## Serialization

The logger handles edge cases automatically:

- **Circular references** -- Replaced with `[Circular]`
- **Long strings** -- Truncated to 1024 characters
- **Error objects** -- Serialized to `{ message, name, stack }`
- **null/undefined values** -- Omitted from output
- **Custom request IDs** -- Read from a header or auto-generated (16-char hex)

## Pattern: Queue Consumer

```ts
import { createLogger } from '@workkit/logger'
import { createConsumer } from '@workkit/queue'

const log = createLogger({ service: 'email-consumer' })

export default {
  queue: createConsumer<EmailMessage>({
    async handle(message) {
      const msgLog = log.child({ messageId: message.id, to: message.body.to })
      msgLog.info('sending email')

      try {
        await sendEmail(message.body)
        msgLog.info('email sent')
        message.ack()
      } catch (error) {
        msgLog.error('email failed', { error })
        message.retry()
      }
    },
  }),
}
```

## Pattern: Cron Handler

```ts
import { createLogger } from '@workkit/logger'
import { createCronHandler } from '@workkit/cron'

const log = createLogger({ service: 'cron' })

export default {
  scheduled: createCronHandler({
    tasks: [{
      schedule: '0 * * * *',
      name: 'cleanup',
      async handler(event, env) {
        const taskLog = log.child({ task: 'cleanup', scheduledTime: event.scheduledTime })
        taskLog.info('starting cleanup')
        const deleted = await cleanup(env)
        taskLog.info('cleanup complete', { deleted })
      },
    }],
  }),
}
```

## Pattern: Error Logging with @workkit/errors

```ts
import { logger, getLogger } from '@workkit/logger'
import { isWorkkitError, serializeError, errorToResponse, wrapError } from '@workkit/errors'

const app = new Hono()
app.use(logger({ service: 'api' }))

app.onError((error, c) => {
  const log = getLogger(c)
  const wrapped = isWorkkitError(error) ? error : wrapError(error)

  log.error('unhandled error', {
    ...serializeError(wrapped),
  })

  return errorToResponse(wrapped)
})
```

## Configuration Reference

### `createLogger(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `"info"` | Minimum level to emit |
| `fields` | `LogFields` | `{}` | Base fields on every entry |

### `logger(options?)` (Hono middleware)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `"info"` | Minimum level to emit |
| `exclude` | `string[]` | `[]` | Paths to skip |
| `requestId` | `string` | auto-generate | Header name for request ID |
| `fields` | `LogFields` | `{}` | Base fields on every entry |
| `timing` | `boolean` | `true` | Auto-log request duration |
| `redact` | `string[] \| Function` | -- | Redact sensitive fields |
