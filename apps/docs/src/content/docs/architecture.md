---
title: "Architecture"
---

# Architecture

## Design Philosophy

workkit is built on three principles:

1. **Composable** -- Each package is independent. Use one, use all, or use any combination. No framework lock-in.
2. **Tree-shakeable** -- Import only what you need. No monolithic bundles. Dead code is eliminated at build time.
3. **Standard Schema** -- Env validation works with any schema library (Zod, Valibot, ArkType) via the Standard Schema spec. No vendor lock-in.

## Package Layers

### Layer 0: Foundation

These packages have no workkit dependencies and form the base of the stack:

| Package | Purpose |
|---------|---------|
| `@workkit/types` | Shared TypeScript types: `Result<T,E>`, branded types, handler signatures, JSON utilities, binding augmentations |
| `@workkit/errors` | Structured error hierarchy with error codes, HTTP mapping, retry strategies, serialization |

### Layer 1: Core

These depend on Layer 0 and wrap individual Cloudflare bindings:

| Package | Wraps | Factory |
|---------|-------|---------|
| `@workkit/env` | `env` object | `parseEnv()`, `parseEnvSync()`, `createEnvParser()` |
| `@workkit/d1` | `D1Database` | `d1(binding, options?)` |
| `@workkit/kv` | `KVNamespace` | `kv<T>(binding, options?)` |
| `@workkit/r2` | `R2Bucket` | `r2(binding, options?)` |
| `@workkit/queue` | `Queue` | `queue<T>(binding)` |
| `@workkit/cache` | Cache API | `cache()`, `swr()`, `tagged()` |
| `@workkit/do` | `DurableObjectStorage` | `typedStorage<T>()`, `createStateMachine()` |
| `@workkit/cron` | `ScheduledEvent` | `createCronHandler()` |
| `@workkit/crypto` | WebCrypto | `hash()`, `encrypt()`, `derive()` |

### Layer 2: Application

These build on Layer 1 for higher-level patterns:

| Package | Purpose |
|---------|---------|
| `@workkit/auth` | JWT signing/verification, sessions (KV-backed), password hashing (PBKDF2), auth middleware |
| `@workkit/ratelimit` | Fixed window, sliding window, token bucket, composite rate limiting (KV-backed) |
| `@workkit/ai` | Workers AI client, streaming, fallback chains, retry, token estimation |
| `@workkit/ai-gateway` | Multi-provider AI gateway (Workers AI, OpenAI, Anthropic, custom), routing, cost tracking, caching |
| `@workkit/agent` | Agent loop primitives — typed tools (Standard Schema), handoffs, streaming events, hooks. Provider-agnostic via `@workkit/ai-gateway` |
| `@workkit/api` | API definition, routing, OpenAPI generation, validation |
| `@workkit/browser` | Cloudflare Browser Rendering primitive — session/page lifecycle, font loading, normalized errors |
| `@workkit/pdf` | HTML → PDF rendering via `@workkit/browser`, R2 storage, presign helpers, header/footer composer |
| `@workkit/notify` | Unified notification dispatch — preferences, opt-out, quiet hours, idempotency, fallback chains. Adapters via subpath imports (`/email`, `/inapp`, `/whatsapp`) |

### Layer 3: Integrations

Framework-specific adapters (optional):

| Package | Integrates with |
|---------|----------------|
| `@workkit/hono` | Hono middleware and bindings |
| `@workkit/astro` | Astro adapter |
| `@workkit/remix` | Remix adapter |

### Tooling

| Package | Purpose |
|---------|---------|
| `@workkit/testing` | Mock bindings for KV, D1, R2, Queue, DO, env, request, context |
| `@workkit/cli` | Project scaffolding and code generation |

## Dependency Graph

```
@workkit/types          (no deps)
@workkit/errors         (no deps)
    |
    +-- @workkit/env
    +-- @workkit/d1
    +-- @workkit/kv
    +-- @workkit/r2
    +-- @workkit/queue   (depends on @workkit/types for TypedQueue)
    +-- @workkit/cache
    +-- @workkit/do      (depends on @workkit/types for TypedDurableObjectStorage)
    +-- @workkit/cron    (depends on @workkit/types for ScheduledEvent)
    +-- @workkit/crypto
    |
    +-- @workkit/auth    (depends on @workkit/errors)
    +-- @workkit/ratelimit (depends on nothing beyond own types)
    +-- @workkit/ai      (depends on @workkit/errors)
    +-- @workkit/ai-gateway (depends on @workkit/errors)
    |
    +-- @workkit/testing (depends on Cloudflare types only, no runtime deps)
```

## Patterns

### Factory + Options

Every binding wrapper uses the same pattern:

```ts
// Factory function takes raw binding + optional config
const db = d1(env.DB, { transformColumns: 'camelCase', logQueries: true })
const store = kv<User>(env.USERS, { prefix: 'user:', defaultTtl: 3600 })

// Access raw binding via .raw
db.raw  // D1Database
store.raw  // KVNamespace
```

### Error Classification

All errors from workkit operations are classified with machine-readable codes and carry retry guidance:

```ts
try {
  await db.first('SELECT ...')
} catch (error) {
  // error.code === 'WORKKIT_D1_QUERY'
  // error.statusCode === 500
  // error.retryable === true
  // error.retryStrategy === { kind: 'exponential', baseMs: 500, ... }
}
```

### Generics Flow Through

Types are defined once at the creation boundary and propagate to all operations:

```ts
interface User { id: number; name: string }

const store = kv<User>(env.USERS_KV)
const user = await store.get('alice')  // User | null (not unknown)
await store.put('alice', { id: 1, name: 'Alice' })  // type-checked
await store.put('alice', { bad: 'data' })  // compile error
```

### Escape Hatches

Every wrapper exposes the raw binding for cases workkit does not cover:

```ts
const db = d1(env.DB)
// Use the raw D1Database directly
const raw = db.raw
const stmt = raw.prepare('PRAGMA table_info(users)')
```
