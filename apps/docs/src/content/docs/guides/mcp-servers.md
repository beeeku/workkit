---
title: "MCP Servers"
---

# MCP Servers

`@workkit/mcp` is "Hono for MCP" — type-safe Model Context Protocol servers on Cloudflare Workers. One tool/resource/prompt definition gives you the MCP JSON-RPC endpoint, a REST surface, and an OpenAPI spec for free. Built on Standard Schema so you can validate with Zod, Valibot, ArkType, or any compliant vendor.

## Install

```bash
bun add @workkit/mcp @workkit/errors hono zod
```

`zod` is only required if you use it as the validator in the examples below. Any [Standard Schema](https://github.com/standard-schema/standard-schema) implementation works (Valibot, ArkType, etc.).

## Quick start

```ts
import { createMCPServer } from "@workkit/mcp";
import { z } from "zod";

const server = createMCPServer({
  name: "weather-mcp",
  version: "1.0.0",
  basePath: "/api",
  mcpPath: "/mcp",
  openapi: { enabled: true, swaggerUI: true },
});

server.tool("get-weather", {
  description: "Fetch current weather for a city",
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number(), conditions: z.string() }),
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (ctx) => {
    const data = await fetchWeather(ctx.input.city);
    return { tempC: data.temp, conditions: data.summary };
  },
});

export default server.serve();
```

That single registration gives you the MCP JSON-RPC endpoint, a REST shortcut, the OpenAPI spec, and Swagger UI all under `basePath`. Use the dev server's request log to discover the exact paths the server registers — they follow the [Hono](https://hono.dev) router conventions.

## Resources and prompts

```ts
server.resource("doc://readme", {
  description: "Project README",
  mimeType: "text/markdown",
  handler: async () => ({ contents: [{ uri: "doc://readme", text: "# Hello" }] }),
});

server.prompt("explain-code", {
  description: "Explain a code snippet",
  args: z.object({ language: z.string(), snippet: z.string() }),
  handler: async (ctx) => ({
    messages: [{ role: "user", content: { type: "text", text: `Explain this ${ctx.input.language}:\n${ctx.input.snippet}` } }],
  }),
});
```

## Tool annotations

Hints follow the MCP 2025-06 spec — clients use them to apply guardrails:

| Annotation | Meaning |
|---|---|
| `readOnlyHint` | Tool does not modify state |
| `destructiveHint` | Tool may delete or overwrite data |
| `idempotentHint` | Repeated calls are safe |
| `openWorldHint` | Tool reaches external services |

## Authentication

`MCPAuthConfig.handler` is a Hono-style middleware: `(request, env, next) => Response | Promise<Response>`. Use it to verify the token and short-circuit unauthenticated requests; otherwise call `next()`.

```ts
const server = createMCPServer({
  name: "secure-api",
  version: "1.0.0",
  auth: {
    type: "bearer",
    handler: async (request, env, next) => {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token || !(await verifyJwt(token, env))) {
        return new Response("unauthorized", { status: 401 });
      }
      return next();
    },
    exclude: ["/openapi.json", "/docs"],
  },
});
```

`type` is informational metadata for clients; the actual verification lives in your `handler`. `exclude` lists paths the middleware skips.

## Sessions (Durable Objects) — roadmap

Stateful tools will opt into DO-backed sessions via the `session` config:

```ts
const server = createMCPServer({
  name: "stateful",
  version: "1.0.0",
  session: { storage: "durable-object", ttl: 3600, maxSessions: 1000 },
});
```

The config type is reserved on `MCPServerConfig` but the runtime wiring (DO class, session lookup header, `sessionId` propagation into handler context) lands in a follow-up release — track [issue #46](https://github.com/beeeku/workkit/issues/46) for the design.

## Middleware

Hono-style middleware composes per server, per tool, or globally:

```ts
server.tool("admin-action", {
  description: "Admin-only",
  input: z.object({ targetId: z.string() }),
  middleware: [requireRole("admin"), rateLimit({ requests: 10, window: "1m" })],
  handler: async (ctx) => { /* ... */ },
});
```

## Validation

`input` and `output` are typed as `StandardSchemaV1<T>`. Runtime validation runs before the handler — invalid inputs return a JSON-RPC error with `code: -32602` (Invalid params). Output validation runs after — schema mismatches surface as `-32603` (Internal error) and never reach the client.

## Mounting on an existing Hono app

`createMCPServer().toHono()` returns a Hono instance you can mount inside your own app:

```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/health", (c) => c.text("ok"));
app.route("/", server.toHono());

export default app;
```

If you need raw fetch handlers instead of a Hono app, call `server.mount()` (no args) — it returns `{ mcpHandler, restHandler, openapi }` you can wire into any router.

## See also

- [Agents](/workkit/guides/agents/) — `@workkit/agent` consumes tools defined as Standard Schema.
- [Authentication](/workkit/guides/authentication/) — wire `@workkit/auth` into the `auth.handler`.
- [MCP specification](https://modelcontextprotocol.io)
