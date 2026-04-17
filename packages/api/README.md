# @workkit/api

> Type-safe API definitions with Standard Schema validation and OpenAPI generation

[![npm](https://img.shields.io/npm/v/@workkit/api)](https://www.npmjs.com/package/@workkit/api)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/api)](https://bundlephobia.com/package/@workkit/api)

## Install

```bash
bun add @workkit/api
```

## Usage

### Before (manual routing and validation)

```ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/users/") && request.method === "GET") {
      const id = url.pathname.split("/")[2] // manual parsing
      // No input validation, no response typing, no OpenAPI
      const user = await getUser(id)
      return new Response(JSON.stringify(user))
    }
  },
}
```

### After (workkit api)

```ts
import { api, createRouter, generateOpenAPI } from "@workkit/api"
import { z } from "zod"

// Define typed endpoints
const getUser = api({
  method: "GET",
  path: "/users/:id",
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  handler: async ({ params, env }) => {
    return await env.DB.getUser(params.id) // params.id is typed
  },
})

const createUser = api({
  method: "POST",
  path: "/users",
  body: z.object({ name: z.string(), email: z.string().email() }),
  response: z.object({ id: z.string() }),
  handler: async ({ body }) => {
    return { id: await createUserInDB(body) } // body is validated and typed
  },
})

// Create router from definitions
const router = createRouter({
  routes: [getUser, createUser],
  cors: { origin: "*" },
})

// Auto-generate OpenAPI spec
const spec = generateOpenAPI({ title: "My API", version: "1.0.0" }, [getUser, createUser])

export default { fetch: router.fetch }
```

Works with any Standard Schema provider: Zod, Valibot, ArkType.

## API

### Definition

- **`api(config)`** — Define a typed API endpoint. Config: `method`, `path`, `params?`, `query?`, `body?`, `response?`, `handler`, `middleware?`

### Router

- **`createRouter(config)`** — Create a fetch handler from API definitions. Config: `routes`, `cors?`, `middleware?`, `notFound?`

### OpenAPI

- **`generateOpenAPI(info, definitions)`** — Generate an OpenAPI 3.1 spec from API definitions
- **`generateLlmsTxt(openapiSpec, options?)`** — Generate a concise `llms.txt` endpoint index
- **`generateLlmsFullTxt(openapiSpec, options?)`** — Generate a detailed `llms-full.txt` API corpus
- **`createLlmsRoutes(config)`** — Add built-in `GET /llms.txt` and `GET /llms-full.txt` handlers

### Validation

- **`validate(schema, data)`** — Validate data against a Standard Schema (async)
- **`validateSync(schema, data)`** — Sync validation
- **`tryValidate(schema, data)`** — Returns `Result` instead of throwing

### Path Utilities

- **`parsePath(pattern)`** — Parse `/users/:id` into segments
- **`matchPath(pattern, pathname)`** — Match and extract path params
- **`buildPath(pattern, params)`** — Build a URL from pattern and params

## License

MIT
