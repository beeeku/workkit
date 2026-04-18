---
title: "Error Handling"
---

# Error Handling

`@workkit/errors` provides a structured error hierarchy for Cloudflare Workers. Every error carries a machine-readable code, HTTP status, retry guidance, and optional context. No more guessing whether to retry or what status code to return.

## Error Hierarchy

All errors extend `WorkkitError`:

| Error Class | Code | Status | Retryable | Default Retry |
|---|---|---|---|---|
| `NotFoundError` | `WORKKIT_NOT_FOUND` | 404 | No | none |
| `ConflictError` | `WORKKIT_CONFLICT` | 409 | Yes | exponential (100ms base, 3 attempts) |
| `ValidationError` | `WORKKIT_VALIDATION` | 400 | No | none |
| `UnauthorizedError` | `WORKKIT_UNAUTHORIZED` | 401 | No | none |
| `ForbiddenError` | `WORKKIT_FORBIDDEN` | 403 | No | none |
| `TimeoutError` | `WORKKIT_TIMEOUT` | 504 | Yes | exponential |
| `RateLimitError` | `WORKKIT_RATE_LIMIT` | 429 | Yes | fixed |
| `ServiceUnavailableError` | `WORKKIT_SERVICE_UNAVAILABLE` | 503 | Yes | exponential |
| `BindingError` | `WORKKIT_BINDING_ERROR` | 500 | No | none |
| `BindingNotFoundError` | `WORKKIT_BINDING_NOT_FOUND` | 500 | No | none |
| `InternalError` | `WORKKIT_INTERNAL` | 500 | No | none |
| `ConfigError` | `WORKKIT_CONFIG` | 500 | No | none |

D1-specific errors (from `@workkit/d1`):

| Error Class | Code | Status | Retryable |
|---|---|---|---|
| `D1QueryError` | `WORKKIT_D1_QUERY` | 500 | No |
| `D1ConstraintError` | `WORKKIT_D1_CONSTRAINT` | 409 | No |
| `D1BatchError` | `WORKKIT_D1_BATCH` | 500 | No |
| `D1MigrationError` | `WORKKIT_D1_MIGRATION` | 500 | No |

## Creating Errors

```ts
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  TimeoutError,
  InternalError,
} from '@workkit/errors'

// Simple
throw new NotFoundError('User', '42')
// message: 'User "42" not found'

// With context
throw new NotFoundError('User', '42', {
  context: { table: 'users', query: 'SELECT ...' },
})

// Validation with issues
throw new ValidationError('Invalid input', [
  { path: ['email'], message: 'Must be a valid email' },
  { path: ['age'], message: 'Must be at least 18' },
])

// With cause (error chaining)
try {
  await someOperation()
} catch (cause) {
  throw new InternalError('Operation failed', { cause })
}

// With custom retry strategy
throw new TimeoutError('API call', 5000, {
  retryStrategy: { kind: 'fixed', delayMs: 2000, maxAttempts: 5 },
})
```

## HTTP Response Mapping

Convert any WorkkitError to an HTTP response:

```ts
import { errorToResponse } from '@workkit/errors'

try {
  // ... handler logic
} catch (error) {
  if (error instanceof WorkkitError) {
    return errorToResponse(error)
    // Response { status: 404, body: { error: { code, message, statusCode } } }
  }
  return new Response('Internal Server Error', { status: 500 })
}
```

The response body includes the error code and message but strips internal details (stack trace, cause) for security:

```json
{
  "error": {
    "code": "WORKKIT_NOT_FOUND",
    "message": "User \"42\" not found",
    "statusCode": 404
  }
}
```

For `ValidationError`, issues are included:

```json
{
  "error": {
    "code": "WORKKIT_VALIDATION",
    "message": "Invalid input",
    "statusCode": 400,
    "issues": [
      { "path": ["email"], "message": "Must be a valid email" }
    ]
  }
}
```

For `RateLimitError`, a `Retry-After` header is set automatically.

### Creating Errors from HTTP Status Codes

Wrap upstream API responses:

```ts
import { fromHttpStatus } from '@workkit/errors'

const response = await fetch('https://api.example.com/data')
if (!response.ok) {
  throw fromHttpStatus(response.status, await response.text())
  // 404 -> NotFoundError
  // 401 -> UnauthorizedError
  // 429 -> RateLimitError
  // 503 -> ServiceUnavailableError
  // 5xx -> InternalError
}
```

## Retry Logic

Every error carries retry guidance. Use the built-in helpers to implement retry loops:

### Retry Strategies

```ts
import { RetryStrategies } from '@workkit/errors'

RetryStrategies.none()                    // { kind: 'none' }
RetryStrategies.immediate(3)              // { kind: 'immediate', maxAttempts: 3 }
RetryStrategies.fixed(1000, 3)            // { kind: 'fixed', delayMs: 1000, maxAttempts: 3 }
RetryStrategies.exponential(500, 30000, 5) // { kind: 'exponential', baseMs: 500, maxMs: 30000, maxAttempts: 5 }
```

### Calculating Delay

```ts
import { getRetryDelay } from '@workkit/errors'

const strategy = { kind: 'exponential', baseMs: 500, maxMs: 30000, maxAttempts: 5 }

getRetryDelay(strategy, 1)  // ~500ms (with jitter)
getRetryDelay(strategy, 2)  // ~1000ms
getRetryDelay(strategy, 3)  // ~2000ms
getRetryDelay(strategy, 5)  // ~8000ms
getRetryDelay(strategy, 6)  // null (exceeded maxAttempts)
```

Exponential backoff includes +/-25% jitter to prevent thundering herd.

### Retry Helper

```ts
import { isRetryable, getRetryDelay, getRetryStrategy } from '@workkit/errors'

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error
      }

      const strategy = getRetryStrategy(error)
      const delay = getRetryDelay(strategy, attempt)
      if (delay === null) throw error

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error('unreachable')
}

// Usage
const data = await withRetry(() => db.first('SELECT ...'))
```

## Type Guards

```ts
import { isWorkkitError, isErrorCode } from '@workkit/errors'

try {
  await someOperation()
} catch (error) {
  if (isWorkkitError(error)) {
    // error is WorkkitError -- has code, statusCode, retryable, etc.
    console.log(error.code)
  }

  if (isErrorCode(error, 'WORKKIT_NOT_FOUND')) {
    // Handle not found specifically
  }
}
```

## Serialization

Serialize errors for logging pipelines:

```ts
import { serializeError, wrapError } from '@workkit/errors'

// Serialize any error (WorkkitError or native) to a structured format
const serialized = serializeError(error)
// {
//   name: 'NotFoundError',
//   code: 'WORKKIT_NOT_FOUND',
//   message: 'User "42" not found',
//   statusCode: 404,
//   retryable: false,
//   retryStrategy: { kind: 'none' },
//   timestamp: '2024-01-01T00:00:00.000Z',
//   context: { resource: 'User', identifier: '42' }
// }

// Wrap an unknown error as a WorkkitError
const wrapped = wrapError(new TypeError('oops'))
// InternalError with the original as cause
```

The `toJSON()` method on WorkkitError produces the same serialized format. Error chains (cause) are serialized recursively.

## Error Context

Every error can carry structured context for debugging:

```ts
const error = new NotFoundError('User', '42', {
  context: {
    table: 'users',
    query: 'SELECT * FROM users WHERE id = ?',
    params: [42],
  },
})

console.log(error.context)
// { resource: 'User', identifier: '42', table: 'users', query: '...', params: [42] }

// Context appears in toString() and toJSON()
console.log(error.toString())
// [WORKKIT_NOT_FOUND] NotFoundError: User "42" not found | context: {...}
```

## Pattern: Global Error Handler

```ts
import { isWorkkitError, errorToResponse, wrapError, serializeError } from '@workkit/errors'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env)
    } catch (error) {
      const workitError = isWorkkitError(error) ? error : wrapError(error)

      // Log structured error
      console.error(JSON.stringify(serializeError(workitError)))

      // Return appropriate HTTP response
      return errorToResponse(workitError)
    }
  },
}
```

## Domain-specific error codes

`@workkit/errors` is the base. Higher-level packages add their own codes that extend the same hierarchy:

| Package | Codes |
|---|---|
| `@workkit/agent` | `WORKKIT_AGENT_HANDOFF_CYCLE`, `WORKKIT_AGENT_BUDGET` |
| `@workkit/memory` | `STORAGE_ERROR`, `EMBEDDING_ERROR`, `VECTORIZE_ERROR`, `CACHE_ERROR`, `ENCRYPTION_ERROR`, `COMPACTION_ERROR`, `NOT_FOUND`, `IDEMPOTENCY_ERROR` (returned via the `MemoryResult<T>` discriminated union, not thrown) |
| `@workkit/workflow` | `WorkflowError` carries `executionId`, `failedStep`, `stepAttempt`, plus the full journal |
| `@workkit/turnstile` | `WORKKIT_TURNSTILE` |

Use `serializeError(err)` for log emission and `errorToResponse(err)` for HTTP responses regardless of which package raised the error.
