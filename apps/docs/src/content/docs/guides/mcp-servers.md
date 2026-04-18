---
title: "MCP Servers"
---

# MCP Servers

`@workkit/mcp` is "Hono for MCP" — type-safe Model Context Protocol servers on Cloudflare Workers. One tool/resource/prompt definition gives you the MCP JSON-RPC endpoint, a REST surface, and an OpenAPI spec for free. Built on Standard Schema so you can validate with Zod, Valibot, ArkType, or any compliant vendor.

## Install

```bash
bun add @workkit/mcp @workkit/errors hono
```

## Quick start

```ts
import { createMCPServer } from "@workkit/mcp";
import { z } from "zod";

const server = createMCPServer({
  name: "weather-mcp",
  version: "1.0.0",
  basePath: "/api",
  mcpPath: "/mcp",
  openapi: { enable: true, swaggerUI: "/docs" },
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

That single registration gives you:

- `POST /api/mcp` — MCP JSON-RPC endpoint (`tools/list`, `tools/call`)
- `POST /api/tools/get-weather` — REST shortcut
- `GET /api/openapi.json` — OpenAPI spec
- `GET /docs` — Swagger UI

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

```ts
const server = createMCPServer({
  name: "secure-api",
  version: "1.0.0",
  auth: {
    type: "bearer",
    handler: async (token) => verifyJwt(token),
    exclude: ["/openapi.json", "/docs"],
  },
});
```

Bearer, API key, and custom (`type: "custom"` with your own handler) are built in.

## Sessions (Durable Objects)

Stateful tools (cursors, pagination, in-flight subscriptions) plug into a DO:

```ts
import { MCPSessionDO } from "@workkit/mcp";
export { MCPSessionDO };

const server = createMCPServer({
  name: "stateful",
  version: "1.0.0",
  session: { storage: env.MCP_SESSIONS, ttl: "1h" },
});
```

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

```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/health", (c) => c.text("ok"));
server.mount(app);  // adds the MCP + REST + OpenAPI routes

export default app;
```

## See also

- [Agents](/workkit/guides/agents/) — `@workkit/agent` consumes tools defined as Standard Schema.
- [Authentication](/workkit/guides/authentication/) — wire `@workkit/auth` into the `auth.handler`.
- [MCP specification](https://modelcontextprotocol.io)
