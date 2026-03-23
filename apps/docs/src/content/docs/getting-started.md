---
title: "Getting Started"
---

# Getting Started

## Installation

workkit is distributed as individual packages. Install only what you need:

```bash
# Core packages (most projects start here)
bun add @workkit/types @workkit/errors @workkit/env

# Add binding-specific packages as needed
bun add @workkit/d1 @workkit/kv @workkit/queue @workkit/cache
bun add @workkit/auth @workkit/ratelimit @workkit/cron
bun add @workkit/ai @workkit/ai-gateway
bun add @workkit/do @workkit/r2 @workkit/crypto
bun add @workkit/logger

# Testing utilities
bun add -d @workkit/testing
```

Each package has `@workkit/errors` and `@workkit/types` as peer dependencies. Install those first.

Or use the interactive CLI to add packages to an existing project:

```bash
bunx workkit add          # interactive multi-select
bunx workkit add kv d1    # add specific packages directly
```

## Your First Worker

Here is a complete Cloudflare Worker using workkit for env validation, D1 queries, and structured error handling:

```ts
import { parseEnvSync } from '@workkit/env'
import { d1 } from '@workkit/d1'
import { errorToResponse, NotFoundError } from '@workkit/errors'
import { z } from 'zod'

// 1. Define your env schema with any Standard Schema validator
const envSchema = {
  DB: z.custom<D1Database>((v) => v != null),
  API_SECRET: z.string().min(1),
}

// 2. Define your types
interface User {
  id: number
  name: string
  email: string
  created_at: string
}

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    // 3. Validate env (fails fast with all issues listed)
    const env = parseEnvSync(rawEnv, envSchema)

    // 4. Create typed D1 client
    const db = d1(env.DB, { transformColumns: 'camelCase' })

    try {
      const url = new URL(request.url)

      if (url.pathname === '/users') {
        const users = await db.all<User>('SELECT * FROM users ORDER BY id')
        return Response.json(users)
      }

      const match = url.pathname.match(/^\/users\/(\d+)$/)
      if (match) {
        const user = await db.first<User>(
          'SELECT * FROM users WHERE id = ?',
          [match[1]],
        )
        if (!user) throw new NotFoundError('User', match[1])
        return Response.json(user)
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      // 5. Structured errors auto-map to HTTP responses
      if (error instanceof WorkkitError) {
        return errorToResponse(error)
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  },
}
```

## Key Concepts

### Standard Schema

workkit's env validation is built on [Standard Schema](https://github.com/standard-schema/standard-schema) -- a shared interface implemented by Zod, Valibot, ArkType, and others. You are never locked into a specific validation library. Any schema that implements the `~standard` protocol works:

```ts
import { parseEnvSync } from '@workkit/env'
import { z } from 'zod'           // or
import * as v from 'valibot'      // or
import { type } from 'arktype'    // any Standard Schema works

const schema = {
  API_KEY: z.string().min(1),      // Zod
  PORT: v.pipe(v.string(), v.transform(Number)),  // Valibot
}
```

### Composable Wrappers

Every binding package (`@workkit/d1`, `@workkit/kv`, `@workkit/queue`, etc.) follows the same pattern: a factory function that wraps a raw Cloudflare binding and returns a typed client:

```ts
const db = d1(env.DB)         // D1Database -> TypedD1
const store = kv(env.CACHE)   // KVNamespace -> WorkkitKV<T>
const events = queue(env.QUEUE) // Queue -> TypedQueueProducer<T>
```

The raw binding is always accessible via `.raw` for escape hatches.

### Structured Errors

All workkit errors extend `WorkkitError` and carry:
- A stable `code` (e.g., `WORKKIT_NOT_FOUND`) for programmatic handling
- An HTTP `statusCode` for automatic response mapping
- A `retryable` flag and `retryStrategy` so callers never guess
- Optional structured `context` for logging

```ts
import { isRetryable, getRetryDelay, errorToResponse } from '@workkit/errors'

try {
  await db.first('SELECT ...')
} catch (error) {
  if (isRetryable(error)) {
    const delay = getRetryDelay(error.retryStrategy, attempt)
    // retry after delay
  }
  return errorToResponse(error) // auto HTTP status + JSON body
}
```

### Tree-Shakeable

Each package exports only what you import. There are no god objects or monolithic bundles. A worker using only `@workkit/kv` does not pull in D1, Queue, or AI code.

### Type Inference

Types flow through the entire stack. `InferEnv<T>` derives your env type from a schema map. `TypedD1` infers row types from generics. `WorkkitKV<T>` ensures get/put type safety. You write types once at the boundary and they propagate everywhere.
