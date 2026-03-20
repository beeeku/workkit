# API Reference

Quick reference of all exported functions, types, and classes per package.

## `@workkit/types`

| Export | Kind | Description |
|--------|------|-------------|
| `Result<T,E>` | type | Discriminated union: `{ ok: true, value: T }` or `{ ok: false, error: E }` |
| `AsyncResult<T,E>` | type | `Promise<Result<T,E>>` |
| `Ok(value)` | function | Create a success Result |
| `Err(error)` | function | Create an error Result |
| `isOk(result)` | function | Type guard for success |
| `isErr(result)` | function | Type guard for error |
| `unwrap(result)` | function | Extract value or throw |
| `Branded<T, Brand>` | type | Nominal typing helper |
| `brand(value, tag)` | function | Brand a value |
| `kvKey(value)` | function | Brand as KVKey |
| `d1RowId(value)` | function | Brand as D1RowId |
| `r2ObjectKey(value)` | function | Brand as R2ObjectKey |
| `durableObjectId(value)` | function | Brand as DurableObjectId |
| `queueMessageId(value)` | function | Brand as QueueMessageId |
| `TypedKVNamespace<T>` | type | Typed KV binding augmentation |
| `TypedD1Result<T>` | type | Typed D1 query result |
| `TypedR2Object` | type | Typed R2 object |
| `TypedQueue<T>` | type | Typed queue binding |
| `TypedMessageBatch<T>` | type | Typed message batch |
| `TypedDurableObjectStorage` | type | Typed DO storage |
| `JsonValue`, `JsonObject`, `JsonArray` | types | JSON-safe types |
| `DeepPartial<T>`, `DeepReadonly<T>` | types | Recursive utility types |
| `WorkerFetchHandler` | type | `fetch()` handler signature |
| `WorkerScheduledHandler` | type | `scheduled()` handler signature |
| `WorkerQueueHandler` | type | `queue()` handler signature |
| `WorkerModule` | type | Full worker module export |
| `ExecutionContext` | type | Worker execution context |
| `ScheduledEvent` | type | Cron trigger event |
| `MaybePromise<T>` | type | `T | Promise<T>` |
| `Prettify<T>` | type | Flatten intersection types |
| `assertNever(x)` | function | Exhaustive switch helper |

## `@workkit/errors`

| Export | Kind | Description |
|--------|------|-------------|
| `WorkkitError` | abstract class | Base error with code, statusCode, retryable, retryStrategy |
| `NotFoundError` | class | 404, not retryable |
| `ConflictError` | class | 409, retryable (exponential) |
| `ValidationError` | class | 400, not retryable, carries `issues[]` |
| `UnauthorizedError` | class | 401, not retryable |
| `ForbiddenError` | class | 403, not retryable |
| `TimeoutError` | class | 504, retryable (exponential) |
| `RateLimitError` | class | 429, retryable (fixed) |
| `ServiceUnavailableError` | class | 503, retryable (exponential) |
| `BindingError` | class | 500, not retryable |
| `BindingNotFoundError` | class | 500, not retryable |
| `InternalError` | class | 500, not retryable |
| `ConfigError` | class | 500, not retryable |
| `RetryStrategies` | object | Factory for retry strategies: `.none()`, `.immediate()`, `.fixed()`, `.exponential()` |
| `getRetryDelay(strategy, attempt)` | function | Calculate delay for attempt, returns `number | null` |
| `isRetryable(error)` | function | Type guard: is error retryable? |
| `getRetryStrategy(error)` | function | Extract retry strategy from any error |
| `errorToResponse(error)` | function | Convert WorkkitError to HTTP Response |
| `fromHttpStatus(status, msg?)` | function | Create WorkkitError from HTTP status code |
| `isWorkkitError(error)` | function | Type guard for WorkkitError |
| `isErrorCode(error, code)` | function | Type guard for specific error code |
| `serializeError(error)` | function | Serialize any error to structured JSON |
| `wrapError(error, msg?)` | function | Wrap unknown error as WorkkitError |

## `@workkit/env`

| Export | Kind | Description |
|--------|------|-------------|
| `parseEnv(rawEnv, schema)` | async function | Validate env (async validators) |
| `parseEnvSync(rawEnv, schema)` | function | Validate env (sync only, throws on async) |
| `createEnvParser(schema)` | function | Create reusable parser with `.parse()` and `.parseSync()` |
| `EnvValidationError` | class | Error with `.issues: EnvIssue[]` |
| `isStandardSchema(value)` | function | Type guard for Standard Schema objects |
| `detectPlatform()` | function | Returns `'workerd' | 'node' | 'bun' | 'deno' | 'unknown'` |
| `resolveEnv()` | function | Get env from current platform |
| `EnvSchema` | type | `Record<string, StandardSchemaV1>` |
| `InferEnv<T>` | type | Infer output types from schema |
| `InferRawEnv<T>` | type | Infer input types from schema |

### `@workkit/env/validators`

| Export | Kind | Description |
|--------|------|-------------|
| `d1()` | function | D1Database binding validator |
| `kv()` | function | KVNamespace binding validator |
| `r2()` | function | R2Bucket binding validator |
| `queue()` | function | Queue binding validator |
| `ai()` | function | AI binding validator |
| `durableObject()` | function | DurableObjectNamespace binding validator |
| `service()` | function | Service binding validator |

## `@workkit/d1`

| Export | Kind | Description |
|--------|------|-------------|
| `d1(binding, options?)` | function | Create typed D1 client |
| `D1Error` | class | Base D1 error |
| `D1QueryError` | class | SQL query error |
| `D1ConstraintError` | class | Constraint violation (409) |
| `D1BatchError` | class | Batch operation error |
| `D1MigrationError` | class | Migration error |
| `classifyD1Error(error, sql?, params?)` | function | Classify raw D1 errors |
| `snakeToCamel(column)` | function | Column name transformer |
| `migrate(db, migrations, options?)` | function | Run pending migrations |
| `migrationStatus(db, migrations, options?)` | function | Check migration status |

### TypedD1 Client Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.first<T>(sql, params?)` | `Promise<T \| null>` | Single row query |
| `.all<T>(sql, params?)` | `Promise<T[]>` | Multi-row query |
| `.run(sql, params?)` | `Promise<D1RunResult>` | Mutation (INSERT/UPDATE/DELETE) |
| `.exec(sql)` | `Promise<D1ExecResult>` | Raw SQL execution |
| `.prepare<T>(sql, params?)` | `TypedPreparedStatement<T>` | Create prepared statement |
| `.batch(statements)` | `Promise<D1BatchResult[]>` | Atomic batch execution |
| `.select<T>(table)` | `SelectBuilder<T>` | Fluent SELECT builder |
| `.insert(table)` | `InsertBuilder` | Fluent INSERT builder |
| `.update(table)` | `UpdateBuilder` | Fluent UPDATE builder |
| `.delete(table)` | `DeleteBuilder` | Fluent DELETE builder |
| `.raw` | `D1Database` | Underlying binding |

## `@workkit/kv`

| Export | Kind | Description |
|--------|------|-------------|
| `kv<T>(binding, options?)` | function | Create typed KV client |
| `validateKey(key)` | function | Validate KV key |
| `prefixKey(prefix, key)` | function | Prepend prefix to key |
| `stripPrefix(prefix, key)` | function | Remove prefix from key |
| `wrapKVError(error, context)` | function | Wrap KV errors with context |
| `assertKVBinding(binding)` | function | Assert binding exists |
| `assertValidTtl(ttl)` | function | Assert TTL >= 60 |

### WorkkitKV Client Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.get(key, options?)` | `Promise<T \| null>` | Get value |
| `.getWithMetadata<M>(key, options?)` | `Promise<{value, metadata, cacheStatus}>` | Get with metadata |
| `.put(key, value, options?)` | `Promise<void>` | Store value |
| `.delete(key)` | `Promise<void>` | Delete key |
| `.getMany(keys, options?)` | `Promise<Map<string, T>>` | Batch get |
| `.putMany(entries, options?)` | `Promise<void>` | Batch put |
| `.deleteMany(keys)` | `Promise<void>` | Batch delete |
| `.list<M>(options?)` | `AsyncIterable<KVListEntry<M>>` | List keys (auto-paginate) |
| `.listKeys(options?)` | `Promise<KVListEntry[]>` | Collect all keys |
| `.has(key)` | `Promise<boolean>` | Check key existence |
| `.raw` | `KVNamespace` | Underlying binding |

## `@workkit/auth`

| Export | Kind | Description |
|--------|------|-------------|
| `signJWT(payload, options)` | async function | Sign a JWT token |
| `verifyJWT(token, options)` | async function | Verify and decode JWT |
| `decodeJWT(token)` | function | Decode JWT without verification |
| `parseDuration(str)` | function | Parse '1h', '30m', '7d' to seconds |
| `hashPassword(password, options?)` | async function | PBKDF2 password hashing |
| `verifyPassword(password, stored)` | async function | Constant-time password verification |
| `createSessionManager(config)` | function | KV-backed session manager |
| `createAuthHandler(config)` | function | Auth middleware factory |
| `extractBearerToken(request)` | function | Extract Bearer token from header |
| `extractBasicAuth(request)` | function | Extract Basic auth credentials |

## `@workkit/ratelimit`

| Export | Kind | Description |
|--------|------|-------------|
| `fixedWindow(options)` | function | Fixed window rate limiter |
| `slidingWindow(options)` | function | Sliding window rate limiter |
| `tokenBucket(options)` | function | Token bucket rate limiter |
| `composite(limiters)` | function | Combine multiple limiters |
| `parseDuration(str)` | function | Parse duration to milliseconds |
| `rateLimitHeaders(result)` | function | Generate X-RateLimit-* headers |
| `rateLimitResponse(result, msg?)` | function | Generate 429 Response |

## `@workkit/ai`

| Export | Kind | Description |
|--------|------|-------------|
| `ai(binding)` | function | Create typed AI client |
| `streamAI(binding, model, input, options?)` | async function | Stream text generation |
| `fallback(binding, models, inputs, options?)` | async function | Try models in order |
| `withRetry(fn, options?)` | async function | Retry wrapper |
| `estimateTokens(text)` | function | Approximate token count |

## `@workkit/ai-gateway`

| Export | Kind | Description |
|--------|------|-------------|
| `createGateway(config)` | function | Multi-provider AI gateway |
| `createRouter(config)` | function | Model-to-provider router |
| `createCostTracker(config)` | function | Token usage and cost tracker |
| `withCache(gateway, config)` | function | Cache wrapper for gateway |
| `withLogging(gateway, config)` | function | Logging wrapper for gateway |

## `@workkit/queue`

| Export | Kind | Description |
|--------|------|-------------|
| `queue<T>(binding)` | function | Create typed queue producer |
| `createConsumer<T>(options)` | function | Per-message consumer handler |
| `createBatchConsumer<T>(options)` | function | Batch consumer handler |
| `createDLQProcessor<T>(options)` | function | Dead letter queue processor |
| `RetryAction` | enum | `ACK`, `RETRY`, `DEAD_LETTER` |

## `@workkit/cron`

| Export | Kind | Description |
|--------|------|-------------|
| `createCronHandler(options)` | function | Route scheduled events to tasks |
| `matchCron(schedule, cron)` | function | Check if cron matches |
| `parseCron(expression)` | function | Parse cron expression |
| `describeCron(expression)` | function | Human-readable description |
| `nextRun(expression)` | function | Next scheduled Date |
| `isValidCron(expression)` | function | Validate cron expression |
| `withTimeout(ms)` | function | Timeout middleware |
| `withRetry(maxRetries, options?)` | function | Retry middleware |
| `withErrorReporting(getQueue, reporter?)` | function | Error reporting middleware |
| `withLock(getKV, key, options, handler)` | function | Distributed lock wrapper |
| `acquireLock(kv, key, options?)` | function | Acquire a KV-based lock |

## `@workkit/do`

| Export | Kind | Description |
|--------|------|-------------|
| `typedStorage<T>(raw)` | function | Type-safe DO storage wrapper |
| `createStateMachine(config)` | function | Finite state machine for DOs |
| `scheduleAlarm(storage, schedule)` | async function | Schedule a DO alarm |
| `createAlarmHandler(config)` | function | Route alarms to named handlers |
| `parseDuration(str)` | function | Parse duration to milliseconds |
| `createDOClient<T>(namespace, id)` | function | Typed RPC client for DO stubs |
| `singleton(namespace, name)` | function | Get named DO instance |

## `@workkit/testing`

| Export | Kind | Description |
|--------|------|-------------|
| `createTestEnv(config)` | function | One-call typed env factory |
| `createMockKV()` | function | In-memory KVNamespace mock |
| `createMockD1()` | function | In-memory D1Database mock |
| `createFailingD1()` | function | Always-failing D1 mock |
| `createMockR2()` | function | In-memory R2Bucket mock |
| `createMockQueue()` | function | In-memory Queue mock |
| `createMockDO()` | function | In-memory DO storage mock |
| `createRequest(path, options?)` | function | Request factory |
| `createExecutionContext()` | function | Mock ExecutionContext |
