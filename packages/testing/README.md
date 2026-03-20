# @workkit/testing

> In-memory mocks for all Cloudflare Workers bindings

[![npm](https://img.shields.io/npm/v/@workkit/testing)](https://www.npmjs.com/package/@workkit/testing)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/testing)](https://bundlephobia.com/package/@workkit/testing)

## Install

```bash
bun add -D @workkit/testing
```

## Usage

### Before (testing with Miniflare or mocking manually)

```ts
// Either spin up Miniflare (slow) or hand-roll mocks for every binding
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  getWithMetadata: vi.fn(),
}
// Repeat for D1, R2, Queue, DO... hundreds of lines of boilerplate
```

### After (workkit testing)

```ts
import {
  createMockKV,
  createMockD1,
  createMockR2,
  createMockQueue,
  createMockDO,
  createTestEnv,
  createRequest,
  createExecutionContext,
} from "@workkit/testing"

// One-liner mocks with real behavior (Map-backed, with expiration support)
const kv = createMockKV()
await kv.put("key", "value", { expirationTtl: 60 })
const val = await kv.get("key") // "value"

// Full test env
const env = createTestEnv({
  MY_KV: createMockKV(),
  DB: createMockD1(),
  BUCKET: createMockR2(),
  QUEUE: createMockQueue(),
})

// Test helpers for requests and execution context
const request = createRequest("https://example.com/api/users", {
  method: "POST",
  body: { name: "Alice" },
})
const ctx = createExecutionContext()

const response = await worker.fetch(request, env, ctx)
```

## API

- **`createMockKV()`** — In-memory KVNamespace with expiration support
- **`createMockD1()`** — In-memory D1Database mock
- **`createFailingD1()`** — D1 mock that throws on every query (for error path testing)
- **`createMockR2()`** — In-memory R2Bucket mock
- **`createMockQueue()`** — In-memory Queue mock (stores sent messages)
- **`createMockDO()`** — In-memory DurableObjectStorage mock
- **`createTestEnv(bindings)`** — Compose bindings into a typed env object
- **`createRequest(url, options?)`** — Create a `Request` with JSON body support
- **`createExecutionContext()`** — Create an `ExecutionContext` with `waitUntil` and `passThroughOnException`

## License

MIT
