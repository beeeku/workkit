# @workkit/mcp

> Hono for MCP — type-safe Model Context Protocol servers on Cloudflare Workers with REST + OpenAPI from one definition.

[![npm](https://img.shields.io/npm/v/@workkit/mcp)](https://www.npmjs.com/package/@workkit/mcp)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/mcp)](https://bundlephobia.com/package/@workkit/mcp)

Define a tool, resource, or prompt once. Get the MCP JSON-RPC endpoint, a REST surface, an OpenAPI 3.1 spec, and Swagger UI for free. Built on Standard Schema so any validator (Zod, Valibot, ArkType, …) works.

## Install

```bash
bun add @workkit/mcp @workkit/errors hono zod
```

## Usage

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

## Mount on existing Hono app

```ts
import { Hono } from "hono";

const app = new Hono();
app.get("/health", (c) => c.text("ok"));
app.route("/", server.toHono());

export default app;
```

For raw fetch handlers, use `server.mount()` (no args) — returns `{ mcpHandler, restHandler, openapi }`.

## Highlights

- Standard Schema input/output validation — works with Zod, Valibot, ArkType
- Tool annotations follow MCP 2025-06 spec (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- One definition → MCP JSON-RPC + REST + OpenAPI 3.1 + Swagger UI
- Hono-style middleware composes per-server, per-tool, or globally
- Pluggable auth: `bearer`, `api-key`, or `custom` middleware
- Optional Durable Object session storage for stateful tools

## Documentation

Full guide: [workkit docs — MCP Servers](https://beeeku.github.io/workkit/guides/mcp-servers/)
