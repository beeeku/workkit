# @workkit/astro

> Astro middleware and helpers for Cloudflare Workers bindings

[![npm](https://img.shields.io/npm/v/@workkit/astro)](https://www.npmjs.com/package/@workkit/astro)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/astro)](https://bundlephobia.com/package/@workkit/astro)

## Install

```bash
bun add @workkit/astro
```

## Usage

### Before (raw Astro + Cloudflare)

```ts
// src/pages/api/users.ts
export async function GET({ locals }) {
  // Access runtime manually — no validation, no types
  const runtime = locals.runtime as any
  const db = runtime.env.DB // untyped, might be undefined
  const data = await db.prepare("SELECT * FROM users").all()
  return new Response(JSON.stringify(data))
}
```

### After (workkit astro)

```ts
// src/middleware.ts
import { workkitMiddleware } from "@workkit/astro"
import { z } from "zod"

export const onRequest = workkitMiddleware({
  env: { DB: z.any(), API_KEY: z.string().min(1) },
  onError: (error) => new Response("Config error", { status: 500 }),
})

// src/env.ts
import { defineEnv } from "@workkit/astro"
import { z } from "zod"

export const env = defineEnv({
  DB: z.any(),
  API_KEY: z.string().min(1),
})

// src/pages/api/users.ts
import { getBinding, getCFProperties } from "@workkit/astro"

export async function GET(context) {
  const db = getBinding(context, "DB") // typed, throws if missing
  const cf = getCFProperties(context) // typed CF properties (country, colo, etc.)
  const apiKey = getBinding(context, "API_KEY") // validated by middleware
  return new Response(JSON.stringify({ colo: cf?.colo }))
}
```

## API

### Middleware

- **`workkitMiddleware(options)`** — Validates env bindings on every request. Options: `env` (schema), `onError?`

### Env

- **`defineEnv(schema)`** — Define a reusable env schema

### Bindings

- **`getBinding(context, name)`** — Get a validated binding from Astro context (throws if missing)
- **`getOptionalBinding(context, name)`** — Get a binding or `undefined`

### Context Helpers

- **`getCFProperties(context)`** — Get Cloudflare-specific request properties (country, colo, etc.)
- **`getWaitUntil(context)`** — Get the `waitUntil` function from the Cloudflare runtime

## License

MIT
