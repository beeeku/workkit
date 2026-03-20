---
title: "KV Patterns"
---

# KV Patterns

`@workkit/kv` wraps Cloudflare Workers KV with typed get/put, automatic serialization, key prefixing, batch operations, and ergonomic error handling.

## Quick Start

```ts
import { kv } from '@workkit/kv'

interface User {
  id: string
  name: string
  role: 'admin' | 'user'
}

const users = kv<User>(env.USERS_KV, {
  prefix: 'user:',
  defaultTtl: 3600,  // 1 hour
})

await users.put('alice', { id: 'alice', name: 'Alice', role: 'admin' })
const user = await users.get('alice')  // User | null
```

## Creating a Client

```ts
import { kv } from '@workkit/kv'

// Basic -- JSON serialization, no prefix
const store = kv<MyType>(env.MY_KV)

// With all options
const store = kv<MyType>(env.MY_KV, {
  prefix: 'cache:',        // auto-prepended to all keys
  defaultTtl: 3600,        // default TTL in seconds
  defaultCacheTtl: 60,     // edge cache TTL for reads
  serializer: 'json',      // 'json' | 'text' | 'arrayBuffer' | 'stream'
})
```

## Core Operations

### Get

```ts
const value = await store.get('key')  // T | null

// Override cache TTL per request
const fresh = await store.get('key', { cacheTtl: false })  // bypass edge cache
const cached = await store.get('key', { cacheTtl: 300 })   // cache for 5 min
```

### Get with Metadata

```ts
interface UserMeta { lastLogin: number }

const result = await store.getWithMetadata<UserMeta>('alice')
// result.value: User | null
// result.metadata: UserMeta | null
// result.cacheStatus: string | null
```

### Put

```ts
// Use default TTL
await store.put('key', value)

// Override TTL
await store.put('key', value, { ttl: 7200 })  // 2 hours

// Absolute expiration
await store.put('key', value, {
  expiration: Math.floor(Date.now() / 1000) + 86400,  // tomorrow
})

// Attach metadata
await store.put('key', value, {
  metadata: { source: 'api', version: 2 },
})
```

### Delete

```ts
await store.delete('key')
```

### Has

Check key existence without reading the value:

```ts
const exists = await store.has('key')  // boolean
```

## Batch Operations

### Get Many

Fetch multiple keys in parallel:

```ts
const results = await store.getMany(['alice', 'bob', 'charlie'])
// results is Map<string, User>

for (const [key, user] of results) {
  console.log(key, user.name)
}
```

### Put Many

Write multiple entries:

```ts
await store.putMany([
  { key: 'alice', value: { id: 'alice', name: 'Alice', role: 'admin' } },
  { key: 'bob', value: { id: 'bob', name: 'Bob', role: 'user' } },
])

// Per-entry options
await store.putMany([
  { key: 'temp', value: data, options: { ttl: 60 } },
  { key: 'permanent', value: data },  // uses defaultTtl
])
```

### Delete Many

```ts
await store.deleteMany(['old-key-1', 'old-key-2', 'old-key-3'])
```

## Listing Keys

### Async Iterator

`list()` returns an `AsyncIterable` that auto-paginates:

```ts
for await (const entry of store.list()) {
  console.log(entry.name)        // key name (prefix stripped)
  console.log(entry.expiration)  // unix timestamp or undefined
  console.log(entry.metadata)    // attached metadata or undefined
}

// Filter by sub-prefix
for await (const entry of store.list({ prefix: 'active:' })) {
  // Only keys matching "user:active:*" (namespace prefix + filter prefix)
}
```

### Collect All Keys

```ts
const allKeys = await store.listKeys()
// KVListEntry[]
```

## Pattern: Caching

```ts
const cache = kv<ApiResponse>(env.CACHE_KV, {
  prefix: 'api:',
  defaultTtl: 300,         // 5 min TTL
  defaultCacheTtl: 60,     // 1 min edge cache
})

async function getWithCache(endpoint: string): Promise<ApiResponse> {
  const cached = await cache.get(endpoint)
  if (cached) return cached

  const response = await fetchFromApi(endpoint)
  await cache.put(endpoint, response)
  return response
}
```

## Pattern: Sessions

```ts
interface SessionData {
  userId: string
  role: string
  expiresAt: number
}

const sessions = kv<SessionData>(env.SESSION_KV, {
  prefix: 'session:',
  defaultTtl: 86400,  // 24 hours
})

// Create session
const sessionId = crypto.randomUUID()
await sessions.put(sessionId, {
  userId: 'user-123',
  role: 'admin',
  expiresAt: Date.now() + 86400000,
})

// Lookup session
const session = await sessions.get(sessionId)
if (!session || session.expiresAt < Date.now()) {
  // expired or not found
}

// Destroy session
await sessions.delete(sessionId)
```

## Pattern: Feature Flags

```ts
interface FeatureFlag {
  enabled: boolean
  rolloutPercent: number
  allowlist: string[]
}

const flags = kv<FeatureFlag>(env.FLAGS_KV, {
  prefix: 'flag:',
  defaultCacheTtl: 30,  // cache flags at edge for 30s
})

async function isEnabled(flag: string, userId: string): Promise<boolean> {
  const config = await flags.get(flag)
  if (!config) return false
  if (!config.enabled) return false
  if (config.allowlist.includes(userId)) return true

  // Deterministic rollout based on user ID
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${flag}:${userId}`),
  )
  const value = new DataView(hash).getUint32(0) / 0xffffffff * 100
  return value < config.rolloutPercent
}
```

## Pattern: Rate Counter

```ts
const counters = kv<number>(env.COUNTER_KV, {
  prefix: 'count:',
  serializer: 'text',  // numbers are serialized as text in KV
})

// Note: KV does not support atomic increments.
// For strict counters, use Durable Objects.
// This pattern works for approximate counters.
async function increment(key: string): Promise<number> {
  const current = await counters.get(key) ?? 0
  const next = current + 1
  await counters.put(key, next)
  return next
}
```

## Key Utilities

```ts
import { validateKey, prefixKey, stripPrefix } from '@workkit/kv'

// Validate a key (throws on empty or invalid)
validateKey('my-key')

// Manual prefix operations
const full = prefixKey('user:', 'alice')    // 'user:alice'
const bare = stripPrefix('user:', 'user:alice')  // 'alice'
```

## Error Handling

KV errors are wrapped with context:

```ts
import { wrapKVError, assertKVBinding, assertValidTtl } from '@workkit/kv'

// These are used internally but available for custom KV logic:
assertKVBinding(env.MY_KV)    // throws BindingNotFoundError if null
assertValidTtl(30)            // throws if TTL < 60 (KV minimum)
```

## Raw Access

```ts
const store = kv<User>(env.USERS_KV)
const raw = store.raw  // KVNamespace

// Use raw KV API directly
const value = await raw.get('my-key', 'text')
```
