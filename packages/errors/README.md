# @workkit/errors

> Structured, retryable error classes for Cloudflare Workers

[![npm](https://img.shields.io/npm/v/@workkit/errors)](https://www.npmjs.com/package/@workkit/errors)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/errors)](https://bundlephobia.com/package/@workkit/errors)

## Install

```bash
bun add @workkit/errors
```

## Usage

### Before (raw errors)

```ts
// Unstructured, no retry info, no HTTP mapping
if (!env.MY_KV) throw new Error("KV not bound")

try {
  await doSomething()
} catch (e) {
  // Is this retryable? What status code? Who knows.
  return new Response("error", { status: 500 })
}
```

### After (workkit errors)

```ts
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
  errorToResponse,
  isRetryable,
} from "@workkit/errors"

// Typed errors with HTTP status codes and retry strategies
throw new NotFoundError("User not found") // 404, not retryable
throw new RateLimitError("Too many requests") // 429, retryable with backoff
throw new ValidationError("Invalid email", [
  { path: ["email"], message: "Must be a valid email" },
])

// Convert any WorkkitError to a proper HTTP Response
app.onError((err) => errorToResponse(err)) // { error: "...", code: "NOT_FOUND" }

// Check retryability and get delay
if (isRetryable(err)) {
  const delay = getRetryDelay(err, attempt) // respects error's retry strategy
}
```

## API

### Error Classes

| Class | Code | Status | Retryable |
|-------|------|--------|-----------|
| `NotFoundError` | `NOT_FOUND` | 404 | No |
| `ValidationError` | `VALIDATION_ERROR` | 400 | No |
| `ConflictError` | `CONFLICT` | 409 | No |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 | No |
| `ForbiddenError` | `FORBIDDEN` | 403 | No |
| `TimeoutError` | `TIMEOUT` | 504 | Yes |
| `RateLimitError` | `RATE_LIMITED` | 429 | Yes |
| `ServiceUnavailableError` | `SERVICE_UNAVAILABLE` | 503 | Yes |
| `BindingNotFoundError` | `BINDING_NOT_FOUND` | 500 | No |
| `InternalError` | `INTERNAL_ERROR` | 500 | No |
| `ConfigError` | `CONFIG_ERROR` | 500 | No |

### Utilities

- **`errorToResponse(err)`** — Convert a `WorkkitError` to a JSON `Response`
- **`fromHttpStatus(status, message)`** — Create a `WorkkitError` from an HTTP status code
- **`isRetryable(err)`** — Check if an error should be retried
- **`getRetryDelay(err, attempt)`** — Calculate retry delay with backoff
- **`serializeError(err)`** — Serialize to JSON-safe object
- **`wrapError(err)`** — Wrap unknown errors as `InternalError`
- **`isWorkkitError(err)`** / **`isErrorCode(err, code)`** — Type guards

## License

MIT
