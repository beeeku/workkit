# @workkit/kv

> Typed KV client with automatic serialization, batching, and key prefixing

[![npm](https://img.shields.io/npm/v/@workkit/kv)](https://www.npmjs.com/package/@workkit/kv)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/kv)](https://bundlephobia.com/package/@workkit/kv)

## Install

```bash
bun add @workkit/kv
```

## Usage

### Before (raw KV API)

```ts
// Manual JSON serialization, no type safety, verbose error handling
const raw = await env.USERS_KV.get("user:alice", "json")
const user = raw as User | null // cast and pray

await env.USERS_KV.put("user:alice", JSON.stringify({ name: "Alice" }), {
  expirationTtl: 3600,
})

// Listing requires manual cursor management
let cursor: string | undefined
const keys: string[] = []
do {
  const result = await env.USERS_KV.list({ cursor })
  keys.push(...result.keys.map((k) => k.name))
  cursor = result.list_complete ? undefined : result.cursor
} while (cursor)
```

### After (workkit kv)

```ts
import { kv } from "@workkit/kv"

const users = kv<User>(env.USERS_KV, { prefix: "user:", defaultTtl: 3600 })

await users.put("alice", { name: "Alice", role: "admin" }) // auto-serialized, auto-prefixed
const user = await users.get("alice") // User | null — typed

// Batch operations
await users.batchPut([
  { key: "bob", value: { name: "Bob", role: "user" } },
  { key: "carol", value: { name: "Carol", role: "admin" } },
])

// Auto-paginated listing
for await (const entry of users.list()) {
  console.log(entry.name) // auto-paginated, prefix stripped
}
```

## API

### `kv<T>(binding, options?)`

Create a typed KV client.

**Options:**
- `prefix` — Key prefix applied to all operations
- `defaultTtl` — Default TTL in seconds for `put()`
- `defaultCacheTtl` — Default cache TTL for `get()`
- `serializer` — `"json"` (default) or `"text"`

**Methods:**
- **`get(key, opts?)`** — Get a value (`T | null`)
- **`getWithMetadata(key, opts?)`** — Get value + metadata
- **`put(key, value, opts?)`** — Store a value
- **`delete(key)`** — Delete a key
- **`list(opts?)`** — Auto-paginated async iterator
- **`batchGet(keys)`** — Get multiple keys
- **`batchPut(entries)`** — Put multiple key-value pairs
- **`batchDelete(keys)`** — Delete multiple keys

### Utilities

- **`validateKey(key)`** — Validate a KV key
- **`prefixKey(prefix, key)`** / **`stripPrefix(prefix, key)`** — Key manipulation

## License

MIT
