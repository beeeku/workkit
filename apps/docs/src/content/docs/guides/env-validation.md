---
title: "Environment Validation"
---

# Environment Validation

`@workkit/env` validates your Cloudflare Worker environment bindings at startup using any Standard Schema-compatible library (Zod, Valibot, ArkType, etc.).

## Why Validate?

Without validation, a missing or misconfigured binding causes a cryptic runtime error deep in your handler. With workkit env validation, you get a clear error at startup listing every issue at once:

```
Environment validation failed:

  Missing:
    ✗ DB -- Required
    ✗ API_KEY -- Required

  Invalid:
    ✗ PORT -- Expected number, received "abc" (received: "abc")

  3 issues found. Check your wrangler.toml bindings and .dev.vars file.
```

## Basic Usage

### With Zod

```ts
import { parseEnvSync } from '@workkit/env'
import { z } from 'zod'

const schema = {
  // String variables
  API_KEY: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'staging']),

  // Bindings (validate they exist)
  DB: z.custom<D1Database>((v) => v != null),
  CACHE: z.custom<KVNamespace>((v) => v != null),

  // Transformed values
  PORT: z.coerce.number().int().min(1).max(65535),
  DEBUG: z.coerce.boolean().default(false),
}

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>) {
    const env = parseEnvSync(rawEnv, schema)
    // env.API_KEY is string
    // env.DB is D1Database
    // env.PORT is number
    // env.DEBUG is boolean
  },
}
```

### With Valibot

```ts
import { parseEnvSync } from '@workkit/env'
import * as v from 'valibot'

const schema = {
  API_KEY: v.pipe(v.string(), v.minLength(1)),
  DB: v.custom<D1Database>((val) => val != null),
  MAX_ITEMS: v.pipe(v.string(), v.transform(Number), v.integer()),
}

const env = parseEnvSync(rawEnv, schema)
```

### With ArkType

```ts
import { parseEnvSync } from '@workkit/env'
import { type } from 'arktype'

const schema = {
  API_KEY: type('string > 0'),
  REGION: type("'us-east-1' | 'eu-west-1' | 'ap-south-1'"),
}

const env = parseEnvSync(rawEnv, schema)
```

## Sync vs Async

Most schema validators are synchronous. Use `parseEnvSync` for those -- it throws if a validator returns a Promise:

```ts
// Preferred for env validation (sync validators are the norm)
const env = parseEnvSync(rawEnv, schema)
```

If you have async validators (rare), use the async version:

```ts
const env = await parseEnv(rawEnv, schema)
```

## Reusable Parsers

When the same schema is used across multiple handlers, create a reusable parser:

```ts
import { createEnvParser } from '@workkit/env'
import { z } from 'zod'

export const envParser = createEnvParser({
  DB: z.custom<D1Database>((v) => v != null),
  CACHE: z.custom<KVNamespace>((v) => v != null),
  API_KEY: z.string().min(1),
})

// In handlers:
const env = envParser.parseSync(rawEnv)

// Access the schema if needed:
envParser.schema
```

## Built-in Binding Validators

`@workkit/env` ships validators for common Cloudflare bindings that produce clear error messages:

```ts
import { parseEnvSync } from '@workkit/env'
import { d1, kv, r2, queue, ai, durableObject, service } from '@workkit/env/validators'

const schema = {
  DB: d1(),                        // validates D1Database binding
  CACHE: kv(),                     // validates KVNamespace binding
  BUCKET: r2(),                    // validates R2Bucket binding
  EVENTS: queue(),                 // validates Queue binding
  AI: ai(),                        // validates AI binding
  COUNTER: durableObject(),        // validates DurableObjectNamespace
  AUTH_SERVICE: service(),         // validates Service binding
}

const env = parseEnvSync(rawEnv, schema)
```

## How It Works

The `EnvSchema` type is defined as:

```ts
type EnvSchema = Record<string, StandardSchemaV1>
```

Each key in the schema map corresponds to an environment variable or binding name. The value is any object implementing the Standard Schema `~standard` protocol. `parseEnvSync` iterates through all entries, validates each one, and collects all issues before throwing a single `EnvValidationError`.

The output type is inferred automatically:

```ts
type InferEnv<T extends EnvSchema> = {
  [K in keyof T]: StandardSchemaV1.InferOutput<T[K]>
}
```

This means your validated `env` object has the exact types your validators produce -- string, number, boolean, D1Database, or whatever the schema outputs.

## Error Handling

`EnvValidationError` extends `WorkkitError` and carries structured issue data:

```ts
import { EnvValidationError } from '@workkit/env'

try {
  const env = parseEnvSync(rawEnv, schema)
} catch (error) {
  if (error instanceof EnvValidationError) {
    // error.issues is EnvIssue[]
    for (const issue of error.issues) {
      console.log(issue.key)      // "DB"
      console.log(issue.message)  // "Required"
      console.log(issue.received) // undefined
    }
  }
}
```

## Detecting the Platform

`@workkit/env` can detect the runtime platform:

```ts
import { detectPlatform } from '@workkit/env'

const platform = detectPlatform()
// 'workerd' | 'node' | 'bun' | 'deno' | 'unknown'
```

This is useful for conditional logic that differs between local development and production.
