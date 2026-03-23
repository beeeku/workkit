# Layer 3-4 Enhancements — Design Spec

**Date:** 2026-03-24
**Author:** Jarvis
**Status:** Approved (autonomous execution — Bikash authorized)
**Scope:** Layer 3 (testing) — 4 features; Layer 4 (framework bindings) — 4 features

---

## Overview

Layer 3 (@workkit/testing) has solid mocks for all CF bindings but lacks observability, seeding, and error injection. Layer 4 (hono, astro, remix integrations) works but doesn't expose the new Layer 2 features. This spec covers enhancements to make testing THE go-to Workers testing library and bring framework bindings up to date with Layer 2.

---

## Layer 3: @workkit/testing — 4 Features

### 3.1 Observable Mocks (Built-in Spies)

Every mock gets automatic operation tracking without requiring external spies.

**New interface added to all mocks:**

```ts
interface MockOperations {
  operations: MockOperation[];
  reads(): MockOperation[];
  writes(): MockOperation[];
  reset(): void;
}

interface MockOperation {
  type: 'read' | 'write' | 'delete' | 'list';
  key?: string;
  timestamp: number;
}
```

**Applied to:** `createMockKV`, `createMockD1`, `createMockR2`, `createMockQueue`, `createMockDO`

Each mock's return type extends with `MockOperations`. Operations are tracked automatically — no user setup needed.

```ts
const kv = createMockKV();
await kv.get('user:1');
await kv.put('key', 'value');

expect(kv.operations).toHaveLength(2);
expect(kv.reads()).toHaveLength(1);
expect(kv.writes()).toHaveLength(1);
```

**Implementation:** Wrap each method to push to an internal `_operations` array before delegating to the real mock logic. Add `operations` getter, `reads()`, `writes()`, `reset()` methods.

### 3.2 Seed Builders

One-call fixture setup for D1 and KV.

```ts
// D1 seeding
const db = createMockD1({
  users: [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ],
  posts: [
    { id: 1, userId: 1, title: 'Hello World' },
  ],
});
// Tables pre-created, rows pre-inserted

// KV seeding
const kv = createMockKV({
  'user:1': { name: 'Alice' },
  'user:2': { name: 'Bob' },
  'config:theme': 'dark',
});
// Keys pre-populated
```

**D1:** The existing `createMockD1` already accepts `initialTables` parameter. Enhance it to also auto-CREATE TABLE from the first row's keys if the table doesn't exist yet.

**KV:** Add optional `initialData` parameter to `createMockKV`. Pre-populate the internal Map from the seed data, serializing values as JSON.

### 3.3 Error Injection

Programmatic failure simulation for resilience testing.

```ts
// Fail after N successful operations
const kv = createMockKV();
kv.failAfter(3); // First 3 ops succeed, then throw

// Fail on specific operations
const db = createMockD1();
db.failOn(/SELECT users/); // Only fail queries matching regex

// Add latency to operations
const r2 = createMockR2();
r2.withLatency(50, 200); // 50-200ms random delay per op
```

**Interface:**

```ts
interface ErrorInjection {
  failAfter(n: number, error?: Error): void;
  failOn(pattern: RegExp, error?: Error): void;
  withLatency(minMs: number, maxMs?: number): void;
  clearInjections(): void;
}
```

Applied to all mocks. `failAfter` counts down operations. `failOn` matches key/query patterns. `withLatency` adds `setTimeout` delay. `clearInjections` resets.

### 3.4 Test Environment Snapshot & Assertions

Helpers for capturing and asserting mock state.

```ts
const env = createTestEnv({
  kv: ['CACHE'],
  d1: ['DB'],
});

// ... run some code ...

// Snapshot captures current state
const snapshot = snapshotEnv(env);
expect(snapshot.CACHE.keyCount).toBe(5);
expect(snapshot.DB.tableCount).toBe(2);
expect(snapshot.DB.rowCount('users')).toBe(10);
```

**New export:**

```ts
function snapshotEnv(env: Record<string, unknown>): EnvSnapshot;

interface EnvSnapshot {
  [bindingName: string]: BindingSnapshot;
}

interface KVSnapshot {
  type: 'kv';
  keyCount: number;
  keys: string[];
}

interface D1Snapshot {
  type: 'd1';
  tableCount: number;
  tables: string[];
  rowCount(table: string): number;
}
```

---

## Layer 4: Framework Bindings — 4 Features

### 4.1 @workkit/hono — Tiered Rate Limiting Middleware

Expose the new `tiered()` limiter through Hono middleware.

```ts
import { tieredRateLimit } from '@workkit/hono';

app.use(tieredRateLimit({
  tiers: { free: { limit: 100 }, pro: { limit: 10000 } },
  window: '1h',
  keyFn: (c) => c.req.header('x-api-key') ?? c.req.header('cf-connecting-ip') ?? 'anonymous',
  tierFn: (c) => c.get('userPlan') ?? 'free',
}));
```

**New export:** `tieredRateLimit(options)` — middleware that combines `tiered()` from `@workkit/ratelimit` with Hono context. Returns proper 429 with rate limit headers.

### 4.2 @workkit/hono — Cache Jitter

Add jitter option to the existing `cacheResponse` middleware to prevent thundering herd.

```ts
app.use(cacheResponse({
  ttl: 3600,
  jitter: 300,  // ±300s random variance on TTL
}));
```

**Change:** Add optional `jitter?: number` to `CacheOptions`. When set, actual TTL = `ttl + random(-jitter, +jitter)`.

### 4.3 @workkit/hono — Quota Middleware

Expose the new `quota()` limiter through Hono middleware.

```ts
import { quotaLimit } from '@workkit/hono';

app.use(quotaLimit({
  limits: [
    { window: '1d', limit: 10000 },
    { window: '1h', limit: 1000 },
  ],
  keyFn: (c) => c.get('userId'),
}));
```

**New export:** `quotaLimit(options)` — middleware wrapping `quota()` from `@workkit/ratelimit`. Returns 429 with quota breakdown in response body.

### 4.4 @workkit/astro & @workkit/remix — Layer 2 Re-exports

Add convenience re-exports so framework users can access Layer 2 features without separate imports.

**@workkit/astro:** Add `createRateLimiter` helper that auto-extracts KV from Astro context.

```ts
import { createRateLimiter } from '@workkit/astro';

const limiter = createRateLimiter(context, 'RATE_LIMIT_KV', {
  limit: 100,
  window: '1m',
});
const result = await limiter.check(ip);
```

**@workkit/remix:** Add `withRateLimit` loader wrapper.

```ts
import { withRateLimit } from '@workkit/remix';

export const loader = withRateLimit(
  { limit: 100, window: '1m', keyFn: (args) => args.request.headers.get('cf-connecting-ip') ?? 'anon' },
  createLoader({ env: schema }, async ({ env, params }) => {
    return { data: 'ok' };
  }),
);
```

---

## File Summary

### Layer 3 — New/Modified Files:
| File | Change |
|------|--------|
| `packages/testing/src/observable.ts` | New — MockOperations interface + tracking helpers |
| `packages/testing/src/error-injection.ts` | New — ErrorInjection interface + injection helpers |
| `packages/testing/src/snapshot.ts` | New — snapshotEnv helper |
| `packages/testing/src/kv.ts` | Modify — add observability, seeding, error injection |
| `packages/testing/src/d1.ts` | Modify — add observability, seed enhancement, error injection |
| `packages/testing/src/r2.ts` | Modify — add observability, error injection |
| `packages/testing/src/queue.ts` | Modify — add observability, error injection |
| `packages/testing/src/do.ts` | Modify — add observability, error injection |
| `packages/testing/src/index.ts` | Modify — re-export new functions |
| `packages/testing/tests/observable.test.ts` | New — operation tracking tests |
| `packages/testing/tests/error-injection.test.ts` | New — failure simulation tests |
| `packages/testing/tests/snapshot.test.ts` | New — env snapshot tests |
| `packages/testing/tests/seed.test.ts` | New — seed builder tests |

### Layer 4 — New/Modified Files:
| File | Change |
|------|--------|
| `integrations/hono/src/tiered-rate-limit.ts` | New — tiered rate limit middleware |
| `integrations/hono/src/quota-limit.ts` | New — quota middleware |
| `integrations/hono/src/cache.ts` | Modify — add jitter option |
| `integrations/hono/src/index.ts` | Modify — re-export new middleware |
| `integrations/hono/tests/tiered-rate-limit.test.ts` | New |
| `integrations/hono/tests/quota-limit.test.ts` | New |
| `integrations/astro/src/ratelimit.ts` | New — createRateLimiter helper |
| `integrations/astro/src/index.ts` | Modify — re-export |
| `integrations/remix/src/ratelimit.ts` | New — withRateLimit wrapper |
| `integrations/remix/src/index.ts` | Modify — re-export |

---

## Testing Strategy

- TDD throughout — tests first for every feature
- Existing tests must not break
- Target: 100% coverage on new code
- Each package tested independently
