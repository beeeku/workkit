# Layer 2 Enhancements — Design Spec

**Date:** 2026-03-24
**Author:** Jarvis + Bikash
**Status:** Approved
**Scope:** 14 new features across 5 Layer 2 packages (cost-weighted tokens already implemented)

---

## Overview

Layer 2 packages (@workkit/crypto, @workkit/cron, @workkit/ratelimit, @workkit/queue, @workkit/do) are at v0.1.0 with solid foundations (85-95% complete, 200+ tests passing). This spec covers the remaining enhancements that make each package compelling and production-ready.

**Implementation strategy:** Parallel Blast (Approach C)
- **Wave 1** (independent, parallelizable): crypto, cron, ratelimit
- **Wave 2** (builds on Wave 1 patterns): queue, do

**Principles:** Karpathy (simplest first, iterate), TDD throughout, functional paradigm, KISS/DRY.

---

## Wave 1: Independent Packages

### 1. @workkit/crypto — 3 features

#### 1.1 Digital Signatures

**New exports:**

```ts
// Signing
sign(privateKey: CryptoKey, data: unknown): Promise<string>  // base64 signature
sign.verify(publicKey: CryptoKey, data: unknown, signature: string): Promise<boolean>

// Key pair management
generateSigningKeyPair(algorithm?: 'Ed25519' | 'ECDSA'): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
}>
exportSigningKey(key: CryptoKey): Promise<string>
importSigningKey(base64: string, type: 'public' | 'private', algorithm?: string): Promise<CryptoKey>
```

**Design decisions:**
- Ed25519 default (smallest signatures, fastest, no parameter choices). ECDSA P-256 as fallback.
- Follows existing `hmac` pattern — callable function with attached `.verify` method via `Object.assign()`.
- Data serialization: same as `encrypt()` — `typeof data === 'string' ? data : JSON.stringify(data)`. Note: this differs from `hmac()` which accepts `string` only. The `unknown` input for `sign()` is intentional since signatures commonly protect structured data (JWTs, API payloads).
- Signature output: base64 (consistent with existing encoding conventions).
- Verification: uses `crypto.subtle.verify()` directly (handles constant-time comparison internally). Does NOT use the manual XOR pattern from `hmac.verify()` — that pattern is for symmetric MACs, not asymmetric signatures.

**Reuses:** `encode()`, `toBase64()`, `fromBase64()`.

**New files:** `src/sign.ts`
**New test file:** `tests/sign.test.ts`

**Test cases:**
- Sign and verify string data
- Sign and verify object data (JSON serialization)
- Verify fails with wrong public key
- Verify fails with tampered data
- Verify fails with tampered signature
- Key pair generation (Ed25519)
- Key pair generation (ECDSA fallback)
- Export/import round-trip for public key
- Export/import round-trip for private key
- Empty data handling
- Large data handling

#### 1.2 Key Rotation

**New export (extends `envelope` namespace):**

```ts
envelope.rotate(
  oldMasterKey: CryptoKey,
  newMasterKey: CryptoKey,
  encryptedKey: string,
  encryptedData: string
): Promise<SealedEnvelope>
```

**Design decisions:**
- Decrypt DEK with old master → re-encrypt DEK with new master. Data stays encrypted with same DEK.
- O(1) regardless of data size — only the DEK is re-encrypted.
- Returns standard `SealedEnvelope` — same shape as `envelope.seal()` output.
- **Prerequisite:** `envelope` is currently NOT exported from `src/index.ts`. Must add `export { envelope } from "./envelope"` before this feature works.
- No new files — extends `src/envelope.ts`.

**Test cases:**
- Rotate and verify data still decryptable with new master key
- Old master key no longer decrypts after rotation
- Rotation preserves original data integrity
- Multiple sequential rotations
- Invalid old master key throws

#### 1.3 Authenticated Metadata (AAD)

**New exports:**

```ts
encryptWithAAD(key: CryptoKey, data: unknown, aad: string): Promise<string>
decryptWithAAD(key: CryptoKey, ciphertext: string, aad: string): Promise<unknown>
```

**Design decisions:**
- Uses AES-GCM native `additionalData` parameter — zero overhead, built into the algorithm.
- Same format as `encrypt()` (base64 with embedded IV).
- AAD is a string (not arbitrary bytes) — simpler API, covers 99% of use cases (user IDs, timestamps, version numbers).
- Tampered AAD causes decryption to fail (AES-GCM guarantees this).
- No new files — extends `src/encrypt.ts`.

**Test cases:**
- Encrypt/decrypt round-trip with AAD
- Decryption fails with wrong AAD
- Decryption fails with empty AAD when non-empty was used
- AAD with special characters
- JSON data with AAD
- String data with AAD

---

### 2. @workkit/cron — 3 features

#### 2.1 Jitter Middleware

**New export:**

```ts
withJitter<E = unknown>(maxSeconds: number): CronMiddleware<E>
```

**Design decisions:**
- Same middleware signature as `withTimeout`, `withRetry`: `(handler, taskName) => CronTaskHandler`.
- Random delay: `Math.random() * maxSeconds * 1000` milliseconds via `setTimeout` wrapped in a Promise.
- Should be innermost middleware (first in array) — jitter before retry/timeout logic.
- Validates `maxSeconds > 0`, throws `ValidationError` otherwise.

**New file:** Added to `src/middleware.ts` (alongside existing middleware).
**Tests added to:** `tests/middleware.test.ts`

**Test cases:**
- Handler executes after a delay within range
- Delay is non-negative and <= maxSeconds
- Composes with existing middleware (withTimeout, withRetry)
- Invalid maxSeconds (0, negative) throws ValidationError
- Handler errors propagate through jitter

#### 2.2 Cron Builder API

**New export:**

```ts
cron(): CronBuilder

interface CronBuilder {
  every(n?: number): EveryBuilder
  at(hour: number, minute?: number): CronBuilder
  on(): OnBuilder
  build(): string
  toString(): string
}

interface EveryBuilder {
  minute(): CronBuilder
  minutes(): CronBuilder   // alias
  hour(): CronBuilder
  hours(): CronBuilder     // alias
  day(): CronBuilder
  weekday(): CronBuilder
  month(): CronBuilder
}

interface OnBuilder {
  monday(): CronBuilder
  tuesday(): CronBuilder
  wednesday(): CronBuilder
  thursday(): CronBuilder
  friday(): CronBuilder
  saturday(): CronBuilder
  sunday(): CronBuilder
  day(n: number): CronBuilder  // day of month
}
```

**Design decisions:**
- Fluent builder pattern — each method returns `this` or a sub-builder for chaining.
- `build()` validates output via `isValidCron()` before returning. Throws `ValidationError` if invalid.
- `toString()` aliases `build()` — enables template literal usage.
- No state mutation of shared objects — each builder call clones internal state.
- Singular/plural aliases (`minute`/`minutes`, `hour`/`hours`) for natural English.

**New file:** `src/builder.ts`
**New test file:** `tests/builder.test.ts`

**Test cases:**
- `cron().every().minute().build()` → `'* * * * *'`
- `cron().every(15).minutes().build()` → `'*/15 * * * *'`
- `cron().every().hour().build()` → `'0 * * * *'`
- `cron().every().day().at(9, 0).build()` → `'0 9 * * *'`
- `cron().every().weekday().at(9).build()` → `'0 9 * * 1-5'`
- `cron().on().monday().at(14, 30).build()` → `'30 14 * * 1'`
- `cron().every(2).hours().build()` → `'0 */2 * * *'`
- `cron().on().day(1).at(0).build()` → `'0 0 1 * *'`
- Invalid builder state throws ValidationError
- `toString()` works in template literals

#### 2.3 Task Dependencies

**Enhanced types:**

```ts
interface CronTask<E = unknown> {
  schedule: string
  handler: CronTaskHandler<E>
  after?: string[]  // task names that must complete before this task runs
}
```

**Design decisions:**
- Topological sort at runtime when tasks are collected for execution.
- Cycle detection at `createCronHandler()` creation time — throws `ValidationError` immediately.
- **Backward compatibility:** Current handler runs tasks sequentially. To avoid a breaking change, parallel execution of independent tasks is opt-in via `parallel?: boolean` on `CronHandlerOptions` (default: `false`). When `false`, tasks execute sequentially in dependency order. When `true`, independent tasks run in parallel.
- If a dependency fails, dependents are skipped and the dependency's error is included in error aggregation.
- Implementation: Kahn's algorithm for topological sort (simple, O(V+E), detects cycles).
- Modifies `src/handler.ts` only.

**Tests added to:** `tests/handler.test.ts`

**Test cases:**
- Tasks with no dependencies run in parallel (existing behavior preserved)
- A → B → C linear dependency chain executes in order
- Diamond dependency (A → B, A → C, B+C → D) resolves correctly
- Circular dependency throws ValidationError at creation
- Failed dependency skips dependents
- Mixed: some tasks independent, some dependent

---

### 3. @workkit/ratelimit — 3 features

#### 3.1 Tiered Rate Limiting

**New export:**

```ts
tiered(options: TieredOptions): TieredRateLimiter

interface TieredOptions {
  namespace: KVNamespace
  tiers: Record<string, TierConfig>
  window: Duration
  defaultTier?: string
  algorithm?: 'fixed' | 'sliding'  // default: 'fixed'
  prefix?: string
}

interface TierConfig {
  limit: number  // Infinity for unlimited
}

interface TieredRateLimiter {
  check(key: string, tier: string): Promise<RateLimitResult>
  forTier(tier: string): RateLimiter  // returns single-arg wrapper for composite()
}
```

**Design decisions:**
- Internally creates limiter instances per tier, lazily on first `check()`.
- `Infinity` limit short-circuits: returns `{ allowed: true, remaining: Infinity, resetAt: new Date(0), limit: Infinity }` without KV access.
- Unknown tier falls back to `defaultTier`. If no default, throws `ValidationError`.
- Prefix includes tier name: `rl:tiered:{prefix}:{tier}:{key}`.
- Not directly composable with `composite()` (takes two args vs one). Provides a `forTier(tier: string): RateLimiter` method that returns a single-arg `check(key)` wrapper suitable for `composite()`.
- Composable with `rateLimitHeaders()`.

**New file:** `src/tiered.ts`
**New test file:** `tests/tiered.test.ts`

**Test cases:**
- Free tier hits limit, pro tier still has remaining
- Infinity tier always allows
- Unknown tier uses defaultTier
- Unknown tier without default throws
- Headers work with tiered results
- Different keys tracked independently per tier

#### 3.2 ~~Cost-Weighted Token Consumption~~ — ALREADY IMPLEMENTED

The existing `tokenBucket().consume(key, tokens?)` already accepts an optional `tokens` parameter (default: 1). No changes needed.

#### 3.3 Quota Buckets

**New exports:**

```ts
quota(options: QuotaOptions): QuotaLimiter

interface QuotaOptions {
  namespace: KVNamespace
  limits: QuotaLimit[]
  prefix?: string
}

interface QuotaLimit {
  window: Duration  // '1d', '30d', etc.
  limit: number
}

interface QuotaLimiter {
  check(key: string, cost?: number): Promise<QuotaResult>
  usage(key: string): Promise<QuotaUsage[]>
}

interface QuotaResult extends RateLimitResult {
  quotas: Array<{
    window: Duration
    used: number
    limit: number
    remaining: number
  }>
}

interface QuotaUsage {
  window: Duration
  used: number
  limit: number
  remaining: number
  resetsAt: Date
}
```

**Design decisions:**
- Calendar-aligned windows: daily resets at midnight UTC, monthly on 1st.
- KV key includes window boundary: `rl:quota:{prefix}:{window}:{boundary}:{key}`.
- TTL set to window duration for automatic cleanup.
- All quota windows checked in parallel. If ANY window exceeded → `allowed: false`.
- Result includes per-window breakdown in `quotas` array.
- `usage()` reads current counters without incrementing.
- Composable with `composite()` — `QuotaLimiter` explicitly implements `RateLimiter` interface via a `check(key)` overload (no cost arg). The `quotas` array in `QuotaResult` is additional detail; base `RateLimitResult` fields use the most restrictive window.

**New file:** `src/quota.ts`
**New test file:** `tests/quota.test.ts`

**Test cases:**
- Daily quota increments and blocks at limit
- Monthly quota increments and blocks at limit
- Multi-window: daily allowed but monthly blocked
- Usage reporting without increment
- Calendar alignment (daily resets at midnight UTC)
- Cost parameter deducts N from quota
- Expired window auto-resets (new day/month)
- Composable with rate limiters via composite()

---

## Wave 2: Pattern-Heavy Packages

### 4. @workkit/queue — 3 features

#### 4.1 Circuit Breaker

**New export:**

```ts
withCircuitBreaker<Body>(
  consumer: ConsumerHandler<Body>,
  options: CircuitBreakerOptions
): ConsumerHandler<Body>

interface CircuitBreakerOptions {
  namespace: KVNamespace
  key: string
  failureThreshold: number
  resetTimeout: Duration
  halfOpenMax?: number  // default: 1
}
```

**Design decisions:**
- Three states: Closed → Open → Half-Open → Closed (or back to Open).
- State stored in KV: `{ state: 'closed'|'open'|'half-open', failures: number, lastFailure: number, openedAt: number }`.
- KV TTL: `resetTimeout * 2` (auto-cleanup of stale state).
- Open state: all messages get `retry({ delaySeconds })` with delay equal to remaining reset time.
- Half-Open: allow `halfOpenMax` messages through. Track via counter in KV.
- Wraps `ConsumerHandler` directly (not cron middleware pattern).
- On success in half-open → reset to closed. On failure in half-open → back to open.
- **KV consistency note:** Like the existing rate limiters, this provides approximate circuit breaking. Under high concurrency, multiple requests may read stale state simultaneously (e.g., both see `halfOpen` and both probe). This is acceptable for most use cases. For strict circuit breaking, use Durable Objects.

**New file:** `src/circuit-breaker.ts`
**New test file:** `tests/circuit-breaker.test.ts`

**Test cases:**
- Closed state: failures below threshold, messages processed
- Closed → Open: threshold exceeded, messages retried with delay
- Open → Half-Open: after resetTimeout, one message allowed through
- Half-Open → Closed: probe succeeds, all messages processed again
- Half-Open → Open: probe fails, back to retrying
- Concurrent requests during state transitions
- KV state persistence across handler invocations

#### 4.2 Workflow Primitives

**New export:**

```ts
createWorkflow<Body, Context = Record<string, unknown>>(
  options: WorkflowOptions<Body, Context>
): ConsumerHandler<Body>

interface WorkflowOptions<Body, Context> {
  steps: WorkflowStep<Body, Context>[]
  onComplete?: (body: Body, context: Context) => Promise<void>
  onError?: (error: unknown, stepName: string, body: Body) => Promise<void>
  maxRetries?: number  // per step, default: 3
}

interface WorkflowStep<Body, Context> {
  name: string
  process: (body: Body, context: Context) => Promise<Partial<Context>>
  rollback?: (body: Body, context: Context) => Promise<void>
}
```

**Design decisions:**
- Linear step execution: step 0 → step 1 → ... → step N → onComplete.
- Context accumulation: each step returns `Partial<Context>`, merged with `Object.assign()`.
- Step tracking: workflow wraps the original message body in an envelope: `{ __workkit_workflow: true, step: 0, context: {}, originalBody: Body }`.
- On step failure with retries remaining → retry message (CF Queue retries re-enter the handler).
- On step failure with no retries → execute rollbacks in reverse order for completed steps → DLQ.
- `onError` called before rollback begins (for logging/alerting).
- First implementation: context embedded in message body. Simple, no external storage needed.
- **Type safety:** `createWorkflow` returns `ConsumerHandler<Body>` but internally wraps the body in an envelope `{ __workkit_workflow: true, step, context, originalBody }`. The handler manages typing internally — consumers pass `Body` typed messages, and the workflow handler detects/creates the envelope transparently. Non-workflow messages (no `__workkit_workflow` flag) enter at step 0.

**New file:** `src/workflow.ts`
**New test file:** `tests/workflow.test.ts`

**Test cases:**
- Simple 2-step workflow completes successfully
- Context merges across steps
- Failed step retries
- Failed step after max retries triggers rollback
- Rollbacks execute in reverse order
- Rollback error doesn't mask original error
- onComplete receives final context
- onError receives step name and error
- Single-step workflow (degenerate case)
- Non-workflow messages passed through to first step (backward compat)

#### 4.3 DLQ Insights

**New export:**

```ts
createDLQAnalyzer<Body>(options: DLQAnalyzerOptions<Body>): DLQAnalyzer<Body>

interface DLQAnalyzerOptions<Body> {
  namespace: KVNamespace
  prefix?: string
  windowSize?: Duration  // default: '1h'
}

interface DLQAnalyzer<Body> {
  record(message: ConsumerMessage<Body>, metadata: DLQMetadata, error?: unknown): Promise<void>
  summary(): Promise<DLQSummary>
  topErrors(limit?: number): Promise<ErrorPattern[]>
}

interface DLQSummary {
  total: number
  byQueue: Record<string, number>
  byHour: Record<string, number>
  topErrors: ErrorPattern[]
}

interface ErrorPattern {
  message: string
  count: number
  lastSeen: Date
  sampleMessageIds: string[]
}
```

**Design decisions:**
- KV-backed aggregation. Keys: `dlq:{prefix}:total`, `dlq:{prefix}:queue:{name}`, `dlq:{prefix}:hour:{iso}`, `dlq:{prefix}:error:{hash}`.
- Error grouping: exact match on `error.message` string (v1). Hash for KV key.
- `record()` increments multiple counters in parallel (Promise.all).
- `summary()` reads all counter keys in parallel.
- `topErrors()` reads error keys, sorts by count, returns top N.
- Sample message IDs capped at 5 per error pattern (prevents unbounded growth).
- Hour keys use ISO-8601 hour format: `2026-03-24T14` with 25h TTL for auto-cleanup.
- Error pattern keys (`dlq:{prefix}:error:{hash}`) also get TTL equal to `windowSize * 24` (default: 24h). Max 100 tracked error patterns — oldest evicted when limit reached.

**New file:** `src/dlq-analyzer.ts`
**New test file:** `tests/dlq-analyzer.test.ts`

**Test cases:**
- Record single failure, summary shows count 1
- Record multiple failures, summary aggregates
- Errors grouped by message string
- topErrors returns sorted by count
- Sample message IDs capped at 5
- byHour histogram populates correctly
- byQueue tracks source queues

---

### 5. @workkit/do — 3 features

#### 5.1 Storage Versioning

**New export:**

```ts
versionedStorage<TSchema extends Record<string, unknown>>(
  raw: TypedDurableObjectStorage,
  options: VersionedStorageOptions<TSchema>
): Promise<TypedStorageWrapper<TSchema>>

interface VersionedStorageOptions<TSchema> {
  version: number
  migrations: Migration[]
}

interface Migration {
  from: number
  to: number
  migrate: (storage: TypedDurableObjectStorage) => Promise<void>
}
```

**Design decisions:**
- Reads `__schema_version` from storage on creation.
- No version stored → assumes version 1, writes current version.
- Migrations run sequentially inside a transaction (atomic).
- Forward-only — no rollback support.
- Returns standard `TypedStorageWrapper` — transparent to consumers.
- Validates migration chain at creation: must be contiguous (1→2, 2→3, not 1→3).

**New file:** `src/versioned-storage.ts`
**New test file:** `tests/versioned-storage.test.ts`

**Test cases:**
- Fresh storage gets version set
- Storage at current version — no migrations run
- Storage at v1, target v3 — runs v1→v2 then v2→v3
- Migration failure rolls back transaction
- Non-contiguous migrations throw ValidationError
- Versioned storage returns standard TypedStorageWrapper interface
- Concurrent version checks (idempotent)

#### 5.2 Event Sourcing

**New export:**

```ts
createEventStore<TState, TEvent extends BaseEvent>(
  storage: TypedDurableObjectStorage,
  options: EventStoreOptions<TState, TEvent>
): EventStore<TState, TEvent>

interface EventStoreOptions<TState, TEvent> {
  initialState: TState
  reducer: (state: TState, event: TEvent) => TState
  snapshotEvery?: number  // default: 50
}

interface EventStore<TState, TEvent> {
  append(event: TEvent): Promise<TState>
  getState(): Promise<TState>
  getEvents(options?: { after?: number; limit?: number }): Promise<StoredEvent<TEvent>[]>
  rebuild(): Promise<TState>
}

interface StoredEvent<TEvent> {
  id: number
  event: TEvent
  timestamp: number
}
```

**Design decisions:**
- Storage keys: `__es_events_{zero-padded-id}` (e.g., `__es_events_000001`), `__es_sequence`, `__es_snapshot`, `__es_snapshot_at`. Zero-padding ensures lexicographic sort matches numeric order for `storage.list()` queries.
- `append()`: increment sequence → store event → reduce → snapshot if interval hit.
- `getState()`: read snapshot → replay events since snapshot sequence.
- `rebuild()`: clear snapshot → replay all events from 0.
- Reducer must be pure (no side effects). State is the sole output.
- Events are immutable — no update or delete operations.
- `getEvents()` supports pagination via `after` (sequence number) and `limit`.

**New file:** `src/event-store.ts`
**New test file:** `tests/event-store.test.ts`

**Test cases:**
- Append event, getState reflects change
- Multiple events accumulate state via reducer
- Snapshot created at interval boundary
- getState works from snapshot (not replaying all events)
- rebuild replays everything from scratch
- getEvents pagination (after, limit)
- Empty store returns initialState
- Concurrent appends get monotonic IDs

#### 5.3 Time-Bucketed Aggregations

**New export:**

```ts
createTimeSeries<TValue = number>(
  storage: TypedDurableObjectStorage,
  options: TimeSeriesOptions<TValue>
): TimeSeries<TValue>

interface TimeSeriesOptions<TValue> {
  prefix: string
  granularity: 'minute' | 'hour' | 'day'
  retention?: Duration  // default: '7d'
  reducer?: (existing: TValue, incoming: TValue) => TValue  // default: numeric sum
}

interface TimeSeries<TValue> {
  record(value: TValue, at?: Date): Promise<void>
  query(from: Date, to: Date): Promise<TimeSeriesEntry<TValue>[]>
  rollup(granularity: 'hour' | 'day'): Promise<TimeSeriesEntry<TValue>[]>
  prune(): Promise<number>
}

interface TimeSeriesEntry<TValue> {
  bucket: Date
  value: TValue
  count: number
}
```

**Design decisions:**
- Storage key format: `{prefix}:{granularity}:{ISO-timestamp}`.
- `record()`: compute bucket key → read existing → reduce → write. Default reducer: `(a, b) => a + b`.
- `query()`: generate all bucket keys in range → `storage.list()` with prefix → filter → sort by bucket.
- `rollup()`: read fine-grained buckets → group by coarser boundary → reduce within groups.
- `prune()`: list all keys with prefix → filter older than retention → batch delete → return count.
- Custom reducers enable non-numeric aggregation (e.g., `{ min, max, avg }` objects).
- `at` parameter defaults to `new Date()` — enables backdating for testing.

**New file:** `src/time-series.ts`
**New test file:** `tests/time-series.test.ts`

**Test cases:**
- Record single value, query returns it
- Multiple records in same bucket aggregate via reducer
- Query across multiple buckets returns sorted entries
- Rollup from minute to hour aggregates correctly
- Prune removes entries older than retention
- Custom reducer (non-numeric values)
- Empty range returns empty array
- Backdated records land in correct bucket

---

## File Summary

### New files (16):
| Package | File | Feature |
|---------|------|---------|
| crypto | `src/sign.ts` | Digital signatures |
| crypto | `tests/sign.test.ts` | Digital signatures tests |
| cron | `src/builder.ts` | Cron builder API |
| cron | `tests/builder.test.ts` | Cron builder tests |
| ratelimit | `src/tiered.ts` | Tiered rate limiting |
| ratelimit | `tests/tiered.test.ts` | Tiered tests |
| ratelimit | `src/quota.ts` | Quota buckets |
| ratelimit | `tests/quota.test.ts` | Quota tests |
| queue | `src/circuit-breaker.ts` | Circuit breaker |
| queue | `tests/circuit-breaker.test.ts` | Circuit breaker tests |
| queue | `src/workflow.ts` | Workflow primitives |
| queue | `tests/workflow.test.ts` | Workflow tests |
| queue | `src/dlq-analyzer.ts` | DLQ insights |
| queue | `tests/dlq-analyzer.test.ts` | DLQ insights tests |
| do | `src/versioned-storage.ts` | Storage versioning |
| do | `tests/versioned-storage.test.ts` | Storage versioning tests |
| do | `src/event-store.ts` | Event sourcing |
| do | `tests/event-store.test.ts` | Event sourcing tests |
| do | `src/time-series.ts` | Time-bucketed aggregations |
| do | `tests/time-series.test.ts` | Time-bucketed aggregations tests |

### Modified files (11):
| Package | File | Change |
|---------|------|--------|
| crypto | `src/envelope.ts` | Add `rotate()` method |
| crypto | `src/encrypt.ts` | Add `encryptWithAAD()`, `decryptWithAAD()` |
| crypto | `src/index.ts` | Re-export new functions + add `envelope` export (prerequisite) |
| cron | `src/middleware.ts` | Add `withJitter()` |
| cron | `src/handler.ts` | Add task dependency resolution |
| cron | `src/index.ts` | Re-export new functions |
| cron | `src/types.ts` | Add `after` field to `CronTask` |
| ratelimit | `src/index.ts` | Re-export new functions |
| queue | `src/index.ts` | Re-export new functions |
| do | `src/index.ts` | Re-export new functions |

---

## Testing Strategy

- **TDD throughout** — tests written before implementation for every feature.
- **Edge cases considered during design** — reflected in test case lists above.
- **Existing tests must not break** — all enhancements are additive.
- **Each package runs independently** — `bun run test` per package, `turbo test` for all.
- **Target: 100% test coverage** on new code.

## Bundle Size Targets

All new features must maintain the "under 5KB gzipped per package" target:
- Signatures add ~1KB (WebCrypto calls + encoding)
- Key rotation adds ~200 bytes (reuses existing encrypt/decrypt)
- AAD adds ~300 bytes (parameter passthrough)
- Cron builder adds ~800 bytes (fluent API)
- Jitter adds ~100 bytes
- Task deps add ~400 bytes (topological sort)
- Tiered limiter adds ~500 bytes (wrapper + lazy init)
- Cost-weighted adds ~50 bytes (parameter addition)
- Quota adds ~800 bytes (calendar alignment logic)
- Circuit breaker adds ~600 bytes (state machine in KV)
- Workflow adds ~1KB (step execution + context tracking)
- DLQ analyzer adds ~700 bytes (KV aggregation)
- Storage versioning adds ~500 bytes (migration runner)
- Event store adds ~1KB (append + snapshot + replay)
- Time series adds ~800 bytes (bucket math + query)
