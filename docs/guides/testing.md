# Testing

`@workkit/testing` provides in-memory mocks for all Cloudflare bindings (KV, D1, R2, Queue, DO), plus factories for Request, ExecutionContext, and a one-call environment builder. Designed for Vitest but works with any test runner.

## Setup

Install the testing package as a dev dependency:

```bash
bun add -d @workkit/testing vitest
```

Configure Vitest in `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

## Creating a Test Environment

The `createTestEnv` factory builds a fully-typed environment object from binding names:

```ts
import { createTestEnv } from '@workkit/testing'

const env = createTestEnv({
  kv: ['CACHE', 'SESSION_KV'] as const,
  d1: ['DB'] as const,
  r2: ['BUCKET'] as const,
  queue: ['EVENTS'] as const,
  do: ['COUNTER'] as const,
  vars: {
    API_URL: 'http://localhost:8787',
    DEBUG: true,
    MAX_ITEMS: 100,
  },
})

// Fully typed:
// env.CACHE     -- KVNamespace (mock)
// env.SESSION_KV -- KVNamespace (mock)
// env.DB        -- D1Database (mock)
// env.BUCKET    -- R2Bucket (mock)
// env.EVENTS    -- Queue (mock)
// env.COUNTER   -- DurableObjectStorage (mock)
// env.API_URL   -- string
// env.DEBUG     -- boolean
// env.MAX_ITEMS -- number
```

## Mock KV

```ts
import { createMockKV } from '@workkit/testing'

const kvMock = createMockKV()

// Use as a KVNamespace
await kvMock.put('key', 'value')
const result = await kvMock.get('key')  // 'value'

// JSON
await kvMock.put('user', JSON.stringify({ name: 'Alice' }))
const user = await kvMock.get('user', 'json')  // { name: 'Alice' }

// Expiration support
await kvMock.put('temp', 'data', { expirationTtl: 60 })

// Metadata
await kvMock.put('key', 'value', { metadata: { version: 1 } })
const result = await kvMock.getWithMetadata('key')
// { value: 'value', metadata: { version: 1 }, cacheStatus: null }

// List
await kvMock.put('user:1', 'Alice')
await kvMock.put('user:2', 'Bob')
const list = await kvMock.list({ prefix: 'user:' })
// { keys: [{ name: 'user:1' }, { name: 'user:2' }], list_complete: true }

// Access internal store for assertions
console.log(kvMock._store.size)  // number of entries
```

## Mock D1

```ts
import { createMockD1, createFailingD1 } from '@workkit/testing'

const d1Mock = createMockD1()

// Provides prepare().bind().first()/all()/run() chain
// Stores data in memory

// For testing error paths:
const failingD1 = createFailingD1()
// Every query throws an error
```

## Mock R2

```ts
import { createMockR2 } from '@workkit/testing'

const r2Mock = createMockR2()

// Implements R2Bucket interface in memory
await r2Mock.put('file.txt', 'hello')
const obj = await r2Mock.get('file.txt')
```

## Mock Queue

```ts
import { createMockQueue } from '@workkit/testing'

const queueMock = createMockQueue()

// Send messages
await queueMock.send({ type: 'user.created', userId: '123' })

// Access sent messages for assertions
console.log(queueMock._messages)
```

## Mock Durable Object

```ts
import { createMockDO } from '@workkit/testing'

const doMock = createMockDO()

// In-memory DurableObjectStorage
await doMock.put('count', 42)
const count = await doMock.get('count')  // 42
```

## Creating Requests

```ts
import { createRequest } from '@workkit/testing'

// GET request (default)
const req = createRequest('/api/users')
// Request to http://localhost/api/users

// POST with JSON body
const req = createRequest('/api/users', {
  method: 'POST',
  body: { name: 'Alice', email: 'alice@example.com' },
})
// Auto-sets Content-Type: application/json

// Custom headers
const req = createRequest('/api/users', {
  headers: {
    'Authorization': 'Bearer token123',
    'X-Custom': 'value',
  },
})

// Full URL
const req = createRequest('https://api.example.com/users')
```

## Creating ExecutionContext

```ts
import { createExecutionContext } from '@workkit/testing'

const ctx = createExecutionContext()

// Use in handler tests
await handler(request, env, ctx)

// Assert on waitUntil promises
console.log(ctx._promises.length)  // number of background tasks queued
await Promise.all(ctx._promises)   // wait for background tasks
```

## Testing a Worker Handler

```ts
import { describe, it, expect } from 'vitest'
import { createTestEnv, createRequest, createExecutionContext } from '@workkit/testing'
import { d1 } from '@workkit/d1'
import handler from '../src/index'

describe('User API', () => {
  const env = createTestEnv({
    d1: ['DB'] as const,
    kv: ['CACHE'] as const,
    vars: { JWT_SECRET: 'test-secret' },
  })

  it('returns 404 for unknown user', async () => {
    const req = createRequest('/users/999')
    const ctx = createExecutionContext()
    const res = await handler.fetch(req, env, ctx)

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('WORKKIT_NOT_FOUND')
  })

  it('creates a user', async () => {
    const req = createRequest('/users', {
      method: 'POST',
      body: { name: 'Alice', email: 'alice@example.com' },
    })
    const ctx = createExecutionContext()
    const res = await handler.fetch(req, env, ctx)

    expect(res.status).toBe(201)
    const user = await res.json()
    expect(user.name).toBe('Alice')
  })
})
```

## Testing with workkit Wrappers

```ts
import { describe, it, expect } from 'vitest'
import { createMockKV } from '@workkit/testing'
import { kv } from '@workkit/kv'

describe('KV operations', () => {
  it('stores and retrieves typed data', async () => {
    const mock = createMockKV()
    const store = kv<{ name: string; score: number }>(mock, { prefix: 'player:' })

    await store.put('alice', { name: 'Alice', score: 100 })
    const result = await store.get('alice')

    expect(result).toEqual({ name: 'Alice', score: 100 })
  })

  it('returns null for missing keys', async () => {
    const mock = createMockKV()
    const store = kv<string>(mock)

    const result = await store.get('nonexistent')
    expect(result).toBeNull()
  })
})
```

## Testing Rate Limiting

```ts
import { describe, it, expect } from 'vitest'
import { createMockKV } from '@workkit/testing'
import { fixedWindow } from '@workkit/ratelimit'

describe('Rate limiting', () => {
  it('blocks after limit exceeded', async () => {
    const mockKV = createMockKV()

    const limiter = fixedWindow({
      namespace: mockKV as any,
      limit: 3,
      window: '1m',
    })

    const r1 = await limiter.check('user:1')
    const r2 = await limiter.check('user:1')
    const r3 = await limiter.check('user:1')
    const r4 = await limiter.check('user:1')

    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
    expect(r3.allowed).toBe(true)
    expect(r4.allowed).toBe(false)
    expect(r4.remaining).toBe(0)
  })
})
```

## Testing Error Handling

```ts
import { describe, it, expect } from 'vitest'
import { NotFoundError, errorToResponse, isWorkkitError } from '@workkit/errors'

describe('Error handling', () => {
  it('converts errors to HTTP responses', () => {
    const error = new NotFoundError('User', '42')
    const response = errorToResponse(error)

    expect(response.status).toBe(404)
  })

  it('includes structured error data', async () => {
    const error = new NotFoundError('User', '42')
    const response = errorToResponse(error)
    const body = await response.json()

    expect(body.error.code).toBe('WORKKIT_NOT_FOUND')
    expect(body.error.message).toBe('User "42" not found')
  })
})
```
