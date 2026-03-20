# @workkit/remix

> Typed Remix loaders and actions with env validation for Cloudflare Workers

[![npm](https://img.shields.io/npm/v/@workkit/remix)](https://www.npmjs.com/package/@workkit/remix)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/remix)](https://bundlephobia.com/package/@workkit/remix)

## Install

```bash
bun add @workkit/remix
```

## Usage

### Before (raw Remix + Cloudflare)

```ts
// app/routes/users.$id.tsx
import type { LoaderFunctionArgs } from "@remix-run/cloudflare"

export async function loader({ params, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as any // untyped
  const db = env.DB // hope it exists
  const user = await db.prepare("SELECT * FROM users WHERE id = ?")
    .bind(params.id)
    .first()
  return Response.json(user)
}
```

### After (workkit remix)

```ts
// app/routes/users.$id.tsx
import { createLoader } from "@workkit/remix"
import { z } from "zod"

export const loader = createLoader(
  { env: { DB: z.any(), API_KEY: z.string().min(1) } },
  async ({ params, env }) => {
    // env.DB — typed and validated
    // env.API_KEY — guaranteed to exist
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(params.id)
      .first()
    return user
  },
)

// app/routes/users.new.tsx
import { createAction, createErrorHandler } from "@workkit/remix"

export const action = createAction(
  { env: { DB: z.any() } },
  async ({ body, env }) => {
    const id = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO users (id, name) VALUES (?, ?)")
      .bind(id, body.name)
      .run()
    return { id }
  },
)

// app/root.tsx — structured error handling
export const ErrorBoundary = createErrorHandler({
  onWorkkitError: (error) => (
    <div>
      <h1>{error.statusCode}</h1>
      <p>{error.message}</p>
    </div>
  ),
})
```

## API

### Loaders

- **`createLoader(options, handler)`** — Typed loader with env validation. Returns auto-serialized JSON responses.
- **`createLoader(handler)`** — Loader without env validation (raw env access).

### Actions

- **`createAction(options, handler)`** — Typed action with env validation and body parsing.
- **`createAction(handler)`** — Action without env validation.

### Env

- **`createEnvFactory(schema)`** — Reusable env parser for use across routes.

### Error Handling

- **`createErrorHandler(options)`** — Converts `WorkkitError` instances to structured error responses.

### Context

- **`getCFContext(args)`** — Extract the Cloudflare load context from Remix args.

## License

MIT
