# Basic Worker

Minimal Cloudflare Worker with typed environment validation using `@workkit/env`.

## What it demonstrates

- **Environment validation** — Define a schema for your bindings and secrets. If anything is missing or misconfigured, you get a clear error at startup instead of a cryptic runtime crash.
- **Binding validators** — Workkit's built-in validators (`kv()`, `d1()`, `r2()`, etc.) duck-type check that Cloudflare bindings have the right methods, catching `wrangler.toml` misconfigurations early.
- **Typed KV** — `@workkit/kv` wraps raw KV with automatic JSON serialization, key prefixing, and TTL defaults.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/env` | Validate and type environment bindings |
| `@workkit/kv` | Typed KV client with serialization |

## Running locally

```bash
# Install dependencies
bun install

# Start local dev server
bun run dev
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Returns a greeting with the current environment |
| GET | `/cache-demo` | Increments and returns a visit counter stored in KV |

## Key concepts

### Before workkit

```ts
// Raw Cloudflare — no safety net
export default {
  async fetch(request, env) {
    // env.CACHE might be undefined if wrangler.toml is wrong
    const value = await env.CACHE.get('key') // string | null
    // Manual parsing, no types, runtime errors
  },
}
```

### After workkit

```ts
import { parseEnv } from '@workkit/env'
import { kv as kvValidator } from '@workkit/env/validators'

const schema = { CACHE: kvValidator() }

export default {
  async fetch(request, rawEnv) {
    const env = await parseEnv(rawEnv, schema)
    // env.CACHE is guaranteed to be a valid KVNamespace
    // TypeScript knows the exact type
  },
}
```
