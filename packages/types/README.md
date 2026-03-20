# @workkit/types

> Shared TypeScript types for Cloudflare Workers bindings, handlers, and utilities

[![npm](https://img.shields.io/npm/v/@workkit/types)](https://www.npmjs.com/package/@workkit/types)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/types)](https://bundlephobia.com/package/@workkit/types)

## Install

```bash
bun add @workkit/types
```

## Usage

### Before (raw Cloudflare types)

```ts
// No type safety on KV values, queue messages, or DO storage
const value = await env.MY_KV.get("key") // string | null — no idea what shape
await env.MY_QUEUE.send({ type: "created" }) // any — no validation
```

### After (workkit types)

```ts
import { type TypedKVNamespace, type TypedQueue, Ok, Err, isOk, unwrap } from "@workkit/types"

// Typed bindings — know exactly what's stored
type Env = {
  MY_KV: TypedKVNamespace<User>
  EVENTS: TypedQueue<UserEvent>
}

// Result type for error handling without exceptions
const result: Result<User, Error> = Ok({ name: "Alice" })
if (isOk(result)) {
  const user = unwrap(result) // User
}

// Branded types prevent mixing up string IDs
import { kvKey, d1RowId } from "@workkit/types"
const key = kvKey("user:123") // KVKey (branded string)
const rowId = d1RowId("abc") // D1RowId (branded string)
```

## API

### Result Types

- **`Ok(value)`** — Wrap a success value
- **`Err(error)`** — Wrap an error value
- **`isOk(result)`** / **`isErr(result)`** — Type guards
- **`unwrap(result)`** — Extract value or throw

### Branded Types

- **`kvKey(s)`**, **`d1RowId(s)`**, **`r2ObjectKey(s)`**, **`durableObjectId(s)`**, **`queueMessageId(s)`** — Create branded string IDs
- **`brand<Tag>(s)`** — Generic branding function

### Binding Types

`TypedKVNamespace<T>`, `TypedD1Result<T>`, `TypedR2Object`, `TypedQueue<T>`, `TypedDurableObjectStorage`, `TypedMessage<T>`, `TypedMessageBatch<T>`

### Handler Types

`WorkerFetchHandler`, `WorkerScheduledHandler`, `WorkerQueueHandler`, `WorkerEmailHandler`, `WorkerModule`

### Utility Types

`JsonValue`, `JsonObject`, `MaybePromise`, `Prettify`, `RequireKeys`, `DeepPartial`, `DeepReadonly`, `NonEmptyArray`, `Dict`

## License

MIT
