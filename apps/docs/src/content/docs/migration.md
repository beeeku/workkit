---
title: "Migration Guide"
---

# Migration Guide

Migrating from raw Cloudflare APIs to workkit. Each section shows a before/after for one package.

## Environment Validation

### Before (raw)

```ts
export default {
  async fetch(request: Request, env: any) {
    // No validation -- runtime errors deep in handlers
    const db = env.DB  // might be undefined
    const key = env.API_KEY  // might be empty string
  },
}
```

### After (workkit)

```ts
import { parseEnvSync } from '@workkit/env'
import { z } from 'zod'

const schema = {
  DB: z.custom<D1Database>((v) => v != null),
  API_KEY: z.string().min(1),
}

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>) {
    const env = parseEnvSync(rawEnv, schema)
    // Fails fast at startup with ALL issues listed
    // env is fully typed: { DB: D1Database, API_KEY: string }
  },
}
```

## D1 Queries

### Before (raw)

```ts
const stmt = env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id)
const result = await stmt.first()
// result is Record<string, unknown> | null
// No column transforms, no error classification
```

### After (workkit)

```ts
import { d1 } from '@workkit/d1'

const db = d1(env.DB, { transformColumns: 'camelCase' })

const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [id])
// user is User | null, with camelCase columns
// D1 errors are classified: D1QueryError, D1ConstraintError, etc.

// Or use the fluent builder:
const user = await db.select<User>('users').where('id = ?', [id]).first()
```

## KV Operations

### Before (raw)

```ts
const raw = await env.MY_KV.get('user:alice', 'json')
// raw is unknown
// No type safety, manual prefix handling, no batch operations
```

### After (workkit)

```ts
import { kv } from '@workkit/kv'

const users = kv<User>(env.MY_KV, { prefix: 'user:', defaultTtl: 3600 })

const user = await users.get('alice')  // User | null, type-safe
await users.put('alice', { name: 'Alice', role: 'admin' })  // type-checked

// Batch operations
const all = await users.getMany(['alice', 'bob', 'charlie'])

// Async iteration over keys
for await (const entry of users.list()) { /* ... */ }
```

## Queue Producing

### Before (raw)

```ts
await env.MY_QUEUE.send({ type: 'created', userId: '123' })
// No type safety on message shape
```

### After (workkit)

```ts
import { queue } from '@workkit/queue'

interface UserEvent {
  type: 'created' | 'updated' | 'deleted'
  userId: string
}

const events = queue<UserEvent>(env.MY_QUEUE)
await events.send({ type: 'created', userId: '123' })  // type-checked
// events.send({ type: 'invalid' })  -- compile error
```

## Queue Consuming

### Before (raw)

```ts
export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      try {
        await processMessage(message.body)
        message.ack()
      } catch {
        message.retry()
      }
    }
  },
}
```

### After (workkit)

```ts
import { createConsumer, RetryAction } from '@workkit/queue'

const handler = createConsumer<UserEvent>({
  async process(message) {
    await processMessage(message.body)
    // void = auto ack
  },
  maxRetries: 3,
  deadLetterQueue: env.DLQ,
  concurrency: 5,
  onError: (error, message) => console.error(error),
})

export default {
  async queue(batch, env) {
    await handler(batch, env)
  },
}
```

## Cron Handling

### Before (raw)

```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case '*/15 * * * *':
        await syncData(env)
        break
      case '0 0 * * *':
        await cleanup(env)
        break
    }
  },
}
```

### After (workkit)

```ts
import { createCronHandler, withTimeout, withRetry } from '@workkit/cron'

const handler = createCronHandler<Env>({
  tasks: {
    'sync-data': {
      schedule: '*/15 * * * *',
      handler: async (event, env) => await syncData(env),
    },
    'cleanup': {
      schedule: '0 0 * * *',
      handler: async (event, env) => await cleanup(env),
    },
  },
  middleware: [
    withTimeout(30000),
    withRetry(3),
  ],
})

export default {
  scheduled: handler,
}
```

## JWT Authentication

### Before (raw)

```ts
// Manual JWT verification with WebCrypto -- 50+ lines of base64/HMAC code
```

### After (workkit)

```ts
import { signJWT, verifyJWT, extractBearerToken } from '@workkit/auth'

const token = await signJWT(
  { userId: 'user-123' },
  { secret: env.JWT_SECRET, expiresIn: '24h' },
)

const payload = await verifyJWT(token, { secret: env.JWT_SECRET })
```

## Password Hashing

### Before (raw)

```ts
// Manual PBKDF2 with WebCrypto, salt generation, hex encoding -- 40+ lines
```

### After (workkit)

```ts
import { hashPassword, verifyPassword } from '@workkit/auth'

const hashed = await hashPassword('secret')
const valid = await verifyPassword('secret', hashed)
```

## Rate Limiting

### Before (raw)

```ts
// Manual KV-based counter with window calculation, TTL management
```

### After (workkit)

```ts
import { fixedWindow, rateLimitResponse } from '@workkit/ratelimit'

const limiter = fixedWindow({
  namespace: env.RATE_LIMIT_KV,
  limit: 100,
  window: '1m',
})

const result = await limiter.check(ip)
if (!result.allowed) return rateLimitResponse(result)
```

## Error Handling

### Before (raw)

```ts
try {
  // ...
} catch (error) {
  // What status code? Is it retryable? What's the error shape?
  return new Response(JSON.stringify({ error: 'Something went wrong' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

### After (workkit)

```ts
import { NotFoundError, errorToResponse, isRetryable } from '@workkit/errors'

try {
  const user = await db.first<User>('SELECT ...', [id])
  if (!user) throw new NotFoundError('User', id)
  return Response.json(user)
} catch (error) {
  // Auto maps to correct HTTP status, includes error code, strips internals
  return errorToResponse(error)
}
```

## Durable Objects

### Before (raw)

```ts
export class Counter implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    const count = await this.state.storage.get('count') ?? 0
    // count is unknown -- needs manual casting
    await this.state.storage.put('count', count + 1)
    return Response.json({ count: count + 1 })
  }
}
```

### After (workkit)

```ts
import { typedStorage } from '@workkit/do'

interface Schema { count: number; lastUpdated: string }

export class Counter implements DurableObject {
  private storage = typedStorage<Schema>(this.state.storage)

  async fetch(request: Request): Promise<Response> {
    const count = await this.storage.get('count') ?? 0
    // count is number | undefined -- type-safe
    await this.storage.put('count', count + 1)  // type-checked
    await this.storage.put('lastUpdated', new Date().toISOString())
    return Response.json({ count: count + 1 })
  }
}
```

## Testing

### Before (raw)

```ts
// Miniflare, or manual mock objects with partial interfaces
const mockKV = {
  get: async () => null,
  put: async () => {},
  // ... many more methods to stub
}
```

### After (workkit)

```ts
import { createTestEnv, createRequest, createExecutionContext } from '@workkit/testing'

const env = createTestEnv({
  kv: ['CACHE'] as const,
  d1: ['DB'] as const,
  vars: { API_KEY: 'test' },
})

const req = createRequest('/api/users', { method: 'POST', body: { name: 'Alice' } })
const ctx = createExecutionContext()
const res = await handler.fetch(req, env, ctx)
```
