# @workkit/mcp — Design Spec

**"Hono for MCP."** One definition generates an MCP tool, a REST endpoint, and an OpenAPI entry. Zero boilerplate. Full MCP spec compliance. Runs on Cloudflare Workers at the edge.

## Goal

Build MCP servers the way you build APIs with Hono — declarative, type-safe, composable. The developer defines tools once and gets:

1. A fully compliant MCP server (Streamable HTTP transport)
2. A REST API with OpenAPI 3.1 documentation
3. Full type inference from schema to handler to client

**The bar:** Fewer lines of code than raw `@modelcontextprotocol/sdk`, better types than FastMCP, and it deploys to Cloudflare Workers with zero config. A developer who knows `@workkit/api` already knows 80% of this package.

## Design Principles

1. **One definition, three outputs** — `server.tool()` is the only API a developer needs to learn. MCP protocol, REST routing, and OpenAPI generation are derived.
2. **Standard Schema everywhere** — Zod, Valibot, ArkType — use whatever you want. We never import a schema library.
3. **Middleware composition** — Same `Middleware` type from `@workkit/api`. Auth, rate limiting, logging — they all just work.
4. **Edge-native** — Designed for Cloudflare Workers constraints: 128MB memory, 30s CPU, DO-backed sessions. Not a Node.js server ported to the edge.
5. **Progressive disclosure** — `createMCPServer` + `server.tool()` + `server.serve()` is the entire beginner API. Resources, prompts, sessions, and middleware are opt-in.

---

## 1. Architecture

### Internal Routing

The server maintains three internal registries populated by `.tool()`, `.resource()`, and `.prompt()` calls. On each incoming request, a Hono router (internal, never exposed to the user) dispatches to one of two paths:

```
                    ┌──────────────────────────────────────────────────┐
                    │              Incoming Request                      │
                    └──────────────┬───────────────────────────────────┘
                                   │
                          ┌────────▼────────┐
                          │  Transport Layer  │
                          │  (Hono router)    │
                          └────────┬────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                      │
    ┌─────────▼──────────┐ ┌──────▼───────┐  ┌──────────▼──────────┐
    │  MCP Protocol Path  │ │  REST Path    │  │  Meta Endpoints      │
    │                      │ │               │  │                      │
    │  POST /mcp           │ │  POST /api/   │  │  GET /openapi.json   │
    │  (Streamable HTTP)   │ │  tools/{name} │  │  GET /health         │
    │                      │ │               │  │  GET /api/docs        │
    │  GET /mcp            │ │               │  │                      │
    │  (SSE, legacy)       │ │               │  │                      │
    └─────────┬────────────┘ └──────┬───────┘  └──────────────────────┘
              │                      │
              │              ┌───────▼────────┐
              │              │  Middleware     │
              │              │  Chain          │
              │              │  (per-tool)     │
              │              └───────┬────────┘
              │                      │
    ┌─────────▼──────────────────────▼──────────┐
    │        Unified Handler Execution           │
    │                                            │
    │  1. Schema validation (Standard Schema)    │
    │  2. Handler invocation                     │
    │  3. Output serialization                   │
    │  4. Error normalization                    │
    └────────────────────────────────────────────┘
              │
    ┌─────────▼────────────┐
    │  Tool/Resource/Prompt │
    │  Registry             │
    │                       │
    │  Map<name, {          │
    │    schema, handler,   │
    │    middleware, meta    │
    │  }>                   │
    └───────────────────────┘
```

**Key insight:** The MCP protocol path and REST path converge at the same handler. The MCP path deserializes JSON-RPC, extracts `method` + `params`, looks up the tool, validates, calls the handler, and wraps the result in JSON-RPC. The REST path extracts the tool name from the URL, validates the JSON body, calls the same handler, and returns a standard HTTP response. Same validation. Same handler. Same errors. Two serialization formats.

### Transport Layer

**Streamable HTTP (primary)** — The June 2025 MCP spec transport. A single `POST /mcp` endpoint handles all JSON-RPC messages. Responses can be immediate JSON or upgraded to SSE for streaming. This is the only transport that supports stateful sessions via the `Mcp-Session-Id` header.

**SSE (legacy)** — `GET /mcp` opens an SSE stream for server-to-client messages. `POST /mcp` sends client-to-server messages. Maintained for backward compatibility with pre-2025 MCP clients. Automatically enabled alongside Streamable HTTP.

**stdio (local dev only)** — For local testing with `npx @workkit/cli dev`. The CLI spawns the worker in a miniflare environment and bridges stdin/stdout to JSON-RPC. Not available in production.

```ts
// Internal transport abstraction
interface MCPTransport {
  handleRequest(request: Request, env: Env): Promise<Response>
  // For SSE/streaming: upgrade to event stream
  upgradeToStream?(request: Request, env: Env): Response
}

// Streamable HTTP transport (default)
class StreamableHTTPTransport implements MCPTransport {
  async handleRequest(request: Request, env: Env): Promise<Response> {
    // POST /mcp → JSON-RPC request/response or SSE upgrade
    // GET /mcp → SSE stream (for server-initiated notifications)
    // DELETE /mcp → session termination
  }
}
```

### Session Management

MCP sessions enable stateful interactions (resource subscriptions, progress tracking, cancellation). On Cloudflare Workers, sessions are backed by Durable Objects.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  MCP Client   │────▶│  Worker       │────▶│  Session DO           │
│               │     │  (stateless)  │     │                       │
│  Mcp-Session- │     │  Routes by    │     │  - subscription state │
│  Id: abc-123  │     │  session ID   │     │  - progress tokens    │
│               │     │  to DO        │     │  - cancellation set   │
└──────────────┘     └──────────────┘     │  - client metadata     │
                                           └──────────────────────┘
```

When a client sends `initialize`, the worker creates a new DO instance and returns `Mcp-Session-Id` in the response header. Subsequent requests with that session ID are routed to the same DO. Sessions expire after a configurable TTL (default: 30 minutes of inactivity, enforced via DO alarm).

**Stateless mode** (default): For tools that don't need sessions (most use cases), the server operates without DOs. No `Mcp-Session-Id` is issued. This is zero-overhead and works on Workers free tier.

**Stateful mode** (opt-in): Enabled by `session: { storage: 'durable-object' }` in config. Required for resource subscriptions, progress notifications, and cancellation.

```ts
// Internal: session DO uses @workkit/do primitives
import { typedStorage, scheduleAlarm } from '@workkit/do'

class MCPSessionDO implements DurableObject {
  private storage: TypedStorageWrapper

  constructor(state: DurableObjectState) {
    this.storage = typedStorage(state.storage)
  }

  async fetch(request: Request): Promise<Response> {
    // Handle session-scoped MCP messages
    // Store subscription state, track progress tokens
  }

  async alarm(): Promise<void> {
    // TTL expiry — clean up session
  }
}
```

---

## 2. Complete API Surface

### `createMCPServer(config)`

The factory function. Returns a server builder.

```ts
import { createMCPServer } from '@workkit/mcp'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
})
```

**Full config type:**

```ts
interface MCPServerConfig<TEnv = unknown> {
  /** Server name (sent in initialize response) */
  name: string
  /** Server version (semver, sent in initialize response) */
  version: string
  /** Optional description for OpenAPI info block */
  description?: string
  /** Server-level instructions for MCP clients (e.g., "Use the search tool before asking questions") */
  instructions?: string
  /** Base path for REST endpoints (default: '/api') */
  basePath?: string
  /** Base path for MCP protocol endpoint (default: '/mcp') */
  mcpPath?: string
  /** CORS configuration for REST endpoints */
  cors?: CorsConfig | boolean
  /** Server-level middleware applied to all tools (REST path only) */
  middleware?: Middleware<TEnv>[]
  /** Session configuration */
  session?: MCPSessionConfig
  /** Auth configuration for REST endpoints */
  auth?: MCPAuthConfig
  /** OpenAPI metadata */
  openapi?: {
    /** Serve OpenAPI spec at /openapi.json (default: true) */
    enabled?: boolean
    /** Serve Swagger UI at /api/docs (default: false). Boolean or config object. */
    swaggerUI?: boolean | { cdn?: boolean; bundle?: boolean }
    /** OpenAPI servers array */
    servers?: Array<{ url: string; description?: string }>
  }
  /** Health endpoint at /health (default: true) */
  health?: boolean
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number
  /** Maximum JSON-RPC batch size (default: 10) */
  maxBatchSize?: number
}

interface MCPSessionConfig {
  /** Session storage backend */
  storage: 'durable-object'
  /** Session TTL in seconds (default: 1800 = 30 min) */
  ttl?: number
  /** Maximum concurrent sessions (default: 1000) */
  maxSessions?: number
}

interface MCPAuthConfig {
  /** Auth strategy — applies to BOTH REST endpoints AND MCP transport */
  type: 'bearer' | 'api-key' | 'custom'
  /** For 'bearer': JWT verification options */
  jwt?: VerifyJWTOptions
  /** For 'api-key': header name (default: 'X-API-Key') */
  headerName?: string
  /** For 'custom': custom auth middleware */
  handler?: Middleware<any>
  /** Paths to exclude from auth (default: ['/health', '/openapi.json']) */
  exclude?: string[]
}
```

> **Auth enforcement on both paths:** `MCPAuthConfig` enforces authentication on the **transport layer** for MCP requests and via **middleware** for REST requests. When `auth` is configured in `MCPServerConfig`, all incoming `POST /mcp` requests have their `Authorization` header validated **before** the JSON-RPC payload is dispatched to the protocol handler. REST endpoints receive the same auth enforcement via Hono middleware injected at the server level. The `/health` and `/openapi.json` paths are excluded by default. This means a single `auth` configuration protects both paths — there is no gap where MCP requests bypass auth while REST requests require it.
>
> ```ts
> // Internal: transport-level auth check for MCP path
> async function handleMCPRequest(request: Request, env: TEnv, authConfig: MCPAuthConfig): Promise<Response> {
>   // Auth check happens BEFORE JSON-RPC parsing
>   const authResult = await validateAuth(request, authConfig)
>   if (!authResult.valid) {
>     return new Response(JSON.stringify({
>       jsonrpc: '2.0',
>       error: { code: -32001, message: 'Unauthorized' },
>       id: null,
>     }), { status: 401, headers: { 'Content-Type': 'application/json' } })
>   }
>   // Only then dispatch to JSON-RPC handler
>   return dispatchJsonRpc(request, env)
> }
> ```

**Return type:**

```ts
interface MCPServer<TEnv = unknown> {
  /** Register a tool */
  tool<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1 | undefined>(
    name: string,
    config: ToolConfig<TInput, TOutput, TEnv>,
  ): MCPServer<TEnv>

  /** Register a resource */
  resource(
    uri: string,
    config: ResourceConfig<TEnv>,
  ): MCPServer<TEnv>

  /** Register a prompt template */
  prompt<TArgs extends StandardSchemaV1 | undefined>(
    name: string,
    config: PromptConfig<TArgs, TEnv>,
  ): MCPServer<TEnv>

  /** Export as Cloudflare Worker module */
  serve(): WorkerModule<TEnv>

  /** Mount into an existing Hono app (for gradual adoption) */
  mount(): {
    mcpHandler: (request: Request, env: TEnv) => Promise<Response>
    restHandler: (request: Request, env: TEnv) => Promise<Response>
    openapi: () => Record<string, unknown>
  }

  /** Get the internal Hono app (escape hatch) */
  toHono(): Hono<{ Bindings: TEnv }>

  /** Get registered tool definitions (useful for testing/introspection) */
  readonly tools: ReadonlyMap<string, RegisteredTool>
  readonly resources: ReadonlyMap<string, RegisteredResource>
  readonly prompts: ReadonlyMap<string, RegisteredPrompt>
}
```

### `server.tool(name, config)`

The primary API. One call registers an MCP tool AND a REST endpoint.

```ts
import { z } from 'zod'

server.tool('search', {
  description: 'Search the knowledge base',
  input: z.object({
    query: z.string().min(1).describe('Search query'),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  output: z.object({
    results: z.array(z.object({
      title: z.string(),
      snippet: z.string(),
      score: z.number(),
    })),
    total: z.number(),
  }),
  handler: async ({ input, env, ctx }) => {
    const results = await env.DB.prepare(
      'SELECT * FROM documents WHERE content MATCH ? LIMIT ?'
    ).bind(input.query, input.limit).all()

    return {
      results: results.rows.map(r => ({
        title: r.title as string,
        snippet: r.snippet as string,
        score: r.score as number,
      })),
      total: results.rows.length,
    }
  },
})
```

**This single definition produces:**

| Output | Details |
|--------|---------|
| MCP tool | `tools/list` returns `{ name: "search", description: "...", inputSchema: {...} }` |
| REST endpoint | `POST /api/tools/search` accepts JSON body, returns JSON response |
| OpenAPI entry | `POST /api/tools/search` with full request/response schemas |

**Full config type:**

```ts
interface ToolConfig<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  /** Human-readable description (appears in MCP tools/list and OpenAPI) */
  description: string
  /** Input schema (Standard Schema v1 — Zod, Valibot, ArkType, etc.) */
  input: TInput
  /** Output schema (optional — enables response validation and richer OpenAPI docs) */
  output?: TOutput
  /** Tool handler */
  handler: ToolHandler<TInput, TOutput, TEnv>
  /** Tags for grouping in OpenAPI and MCP (MCP spec supports tool annotations) */
  tags?: string[]
  /** MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) */
  annotations?: ToolAnnotations
  /** Middleware applied to this tool's REST endpoint */
  middleware?: Middleware<TEnv>[]
  /** Timeout in milliseconds (default: 25000, just under CF's 30s CPU limit) */
  timeout?: number
  /** Whether this tool supports progress notifications (requires stateful session) */
  progress?: boolean
  /** Whether this tool supports cancellation */
  cancellable?: boolean
}

/** MCP 2025-06 tool annotations */
interface ToolAnnotations {
  /** Tool does not modify state (default: false) */
  readOnlyHint?: boolean
  /** Tool performs destructive operations (default: false) */
  destructiveHint?: boolean
  /** Tool can be called multiple times with same input safely (default: false) */
  idempotentHint?: boolean
  /** Tool interacts with external systems beyond the server (default: true) */
  openWorldHint?: boolean
}
```

**Type inference chain:**

```ts
// Given:
const InputSchema = z.object({ query: z.string(), limit: z.number() })
const OutputSchema = z.object({ results: z.array(z.string()) })

server.tool('search', {
  input: InputSchema,    // TInput = typeof InputSchema
  output: OutputSchema,  // TOutput = typeof OutputSchema
  handler: async ({ input, env }) => {
    // input is inferred as { query: string; limit: number }
    //   ↑ InferOutput<typeof InputSchema>

    // Return type must be { results: string[] }
    //   ↑ InferOutput<typeof OutputSchema>
    return { results: ['hello'] }
  },
})
```

**The inference path:**

```
StandardSchemaV1<I, O>
       │
       ▼
TInput extends StandardSchemaV1
       │
       ▼ InferOutput<TInput>
       │
ToolHandler receives: { input: InferOutput<TInput> }
       │
       ▼
Handler return type: TOutput extends StandardSchemaV1
                       ? InferOutput<TOutput>
                       : unknown
```

**Handler context type:**

```ts
// Note: MaybePromise<T> = T | Promise<T> — exported from @workkit/types
type ToolHandler<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1 | undefined,
  TEnv,
> = (
  ctx: ToolHandlerContext<TInput, TEnv>,
) => MaybePromise<
  TOutput extends StandardSchemaV1 ? InferOutput<TOutput> : unknown
>

interface ToolHandlerContext<
  TInput extends StandardSchemaV1,
  TEnv,
> {
  /** Validated input (type-safe from schema) */
  input: InferOutput<TInput>
  /** Worker environment bindings */
  env: TEnv
  /** Execution context (waitUntil, passThroughOnException) */
  ctx: ExecutionContext
  /** Original request (available on REST path, synthetic on MCP path) */
  request: Request
  /** Logger instance (from @workkit/logger) */
  log: Logger
  /** Report progress (only available if tool.progress: true and stateful session active) */
  reportProgress: (progress: number, total?: number) => Promise<void>
  /** Abort signal (fires on client disconnection or cancellation) */
  signal: AbortSignal
  /** Session ID (undefined in stateless mode) */
  sessionId?: string
}
```

### `server.resource(uri, config)`

Register an MCP resource. Resources are read-only data endpoints that clients can fetch.

```ts
server.resource('config://app/settings', {
  description: 'Application settings',
  mimeType: 'application/json',
  handler: async ({ uri, env }) => {
    const settings = await env.KV.get('app-settings', 'json')
    return {
      contents: [{
        uri: 'config://app/settings',
        mimeType: 'application/json',
        text: JSON.stringify(settings),
      }],
    }
  },
})
```

**With URI templates:**

```ts
server.resource('file://docs/{path}', {
  description: 'Documentation files',
  mimeType: 'text/markdown',
  handler: async ({ uri, params, env }) => {
    // params.path is extracted from the URI template
    const content = await env.R2.get(`docs/${params.path}`)
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: await content.text(),
      }],
    }
  },
})
```

**Full config type:**

```ts
interface ResourceConfig<TEnv = unknown> {
  /** Human-readable description */
  description?: string
  /** MIME type of the resource content */
  mimeType?: string
  /** Resource handler */
  handler: ResourceHandler<TEnv>
  /** Whether this resource supports subscriptions (requires stateful session) */
  subscribe?: boolean
}

type ResourceHandler<TEnv> = (
  ctx: ResourceHandlerContext<TEnv>,
) => MaybePromise<ResourceResult>

interface ResourceHandlerContext<TEnv> {
  /** The resolved URI (after template substitution) */
  uri: string
  /** Extracted parameters from URI template */
  params: Record<string, string>
  /** Worker environment bindings */
  env: TEnv
  /** Execution context */
  ctx: ExecutionContext
  /** Logger instance */
  log: Logger
}

interface ResourceResult {
  contents: Array<{
    uri: string
    mimeType?: string
    text?: string
    blob?: Uint8Array
  }>
}
```

**URI template matching:**

URI templates follow RFC 6570 Level 1 (simple string expansion). Templates are matched against incoming `resources/read` URIs:

| Template | Matches | `params` |
|----------|---------|----------|
| `config://app/settings` | Exact match only | `{}` |
| `file://docs/{path}` | `file://docs/readme.md` | `{ path: 'readme.md' }` |
| `db://users/{id}` | `db://users/abc-123` | `{ id: 'abc-123' }` |

Resources do NOT generate REST endpoints (they're MCP-only). If you want a REST endpoint for data, use `server.tool()`.

### `server.prompt(name, config)`

Register an MCP prompt template. Prompts are reusable message sequences that clients can request.

```ts
server.prompt('summarize', {
  description: 'Summarize a document',
  args: z.object({
    documentId: z.string().describe('ID of the document to summarize'),
    style: z.enum(['brief', 'detailed', 'bullets']).default('brief'),
  }),
  handler: async ({ args, env }) => {
    const doc = await env.DB.prepare(
      'SELECT content FROM documents WHERE id = ?'
    ).bind(args.documentId).first()

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Summarize the following document in ${args.style} style:\n\n${doc.content}`,
          },
        },
      ],
    }
  },
})
```

**Full config type:**

```ts
interface PromptConfig<
  TArgs extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  /** Human-readable description */
  description?: string
  /** Argument schema (optional) */
  args?: TArgs
  /** Prompt handler — returns message array */
  handler: PromptHandler<TArgs, TEnv>
}

type PromptHandler<
  TArgs extends StandardSchemaV1 | undefined,
  TEnv,
> = (
  ctx: PromptHandlerContext<TArgs, TEnv>,
) => MaybePromise<PromptResult>

interface PromptHandlerContext<
  TArgs extends StandardSchemaV1 | undefined,
  TEnv,
> {
  /** Validated arguments (type-safe from schema) */
  args: TArgs extends StandardSchemaV1 ? InferOutput<TArgs> : undefined
  /** Worker environment bindings */
  env: TEnv
  /** Execution context */
  ctx: ExecutionContext
  /** Logger instance */
  log: Logger
}

interface PromptResult {
  description?: string
  messages: Array<PromptMessage>
}

interface PromptMessage {
  role: 'user' | 'assistant'
  content: TextContent | ImageContent | EmbeddedResource
}

interface TextContent {
  type: 'text'
  text: string
}

interface ImageContent {
  type: 'image'
  data: string  // base64
  mimeType: string
}

interface EmbeddedResource {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string  // base64
  }
}
```

### `server.serve()`

Export as a Cloudflare Worker module. This is the terminal call — returns the `export default` value.

```ts
// worker.ts
import { createMCPServer } from '@workkit/mcp'
import { z } from 'zod'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
})

server.tool('hello', {
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
})

export default server.serve()
```

**What `.serve()` returns:**

```ts
interface WorkerModule<TEnv> {
  fetch: (request: Request, env: TEnv, ctx: ExecutionContext) => Promise<Response>
}
```

Internally, `.serve()` does:
1. Freezes the tool/resource/prompt registries (no more registrations after serve)
2. Validates for name collisions, missing descriptions, etc.
3. **Logs a warning if no tools are registered** — a server with zero tools is technically valid (it can still serve resources/prompts) but is almost always a mistake. The warning includes a suggestion to register at least one tool.
4. Builds the internal Hono app with all routes
5. Generates the OpenAPI spec (cached, computed once)
6. Returns the Worker module

---

## 3. MCP Protocol Compliance

### Supported Methods (MCP 2025-06)

| JSON-RPC Method | Handler | Notes |
|----------------|---------|-------|
| `initialize` | Built-in | Returns server info + capabilities |
| `initialized` | Built-in (notification) | Client confirms initialization |
| `ping` | Built-in | Returns `{}` |
| `tools/list` | Built-in | Returns all registered tools with schemas |
| `tools/call` | Routes to tool handler | Validates input, runs handler |
| `resources/list` | Built-in | Returns all registered resources |
| `resources/read` | Routes to resource handler | Matches URI, runs handler |
| `resources/templates/list` | Built-in | Returns URI templates |
| `resources/subscribe` | Built-in (stateful only) | Registers subscription |
| `resources/unsubscribe` | Built-in (stateful only) | Removes subscription |
| `prompts/list` | Built-in | Returns all registered prompts |
| `prompts/get` | Routes to prompt handler | Validates args, runs handler |
| `logging/setLevel` | Built-in | Sets min log level for notifications |
| `completion/complete` | Built-in | Autocomplete for resource URIs and prompt args |

### Capability Negotiation

On `initialize`, the server responds with its capability object:

```ts
// Internal: built from registered tools/resources/prompts
function buildCapabilities(server: MCPServer): ServerCapabilities {
  const capabilities: ServerCapabilities = {}

  if (server.tools.size > 0) {
    capabilities.tools = { listChanged: true }
  }

  if (server.resources.size > 0) {
    capabilities.resources = {
      subscribe: hasSubscribableResources(server),
      listChanged: true,
    }
  }

  if (server.prompts.size > 0) {
    capabilities.prompts = { listChanged: true }
  }

  capabilities.logging = {}

  return capabilities
}
```

The `initialize` response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "prompts": { "listChanged": true },
      "logging": {}
    },
    "serverInfo": {
      "name": "my-tools",
      "version": "1.0.0"
    },
    "instructions": "Use the search tool before asking questions."
  }
}
```

### Progress Notifications

For long-running tools, the handler can report progress to the client. Progress notifications require a stateful session (SSE or Streamable HTTP with session).

```ts
server.tool('index-documents', {
  description: 'Index all documents in the knowledge base',
  input: z.object({ collection: z.string() }),
  progress: true,  // Enable progress support
  timeout: 300_000, // 5 minutes (use DO-based execution for long tasks)
  handler: async ({ input, env, reportProgress }) => {
    const docs = await env.DB.prepare(
      'SELECT * FROM documents WHERE collection = ?'
    ).bind(input.collection).all()

    let indexed = 0
    for (const doc of docs.results) {
      await indexDocument(env, doc)
      indexed++
      await reportProgress(indexed, docs.results.length)
    }

    return { indexed, total: docs.results.length }
  },
})
```

When `reportProgress(5, 100)` is called, the server sends a JSON-RPC notification:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "call-abc-123",
    "progress": 5,
    "total": 100
  }
}
```

The `progressToken` is provided by the client in the original `tools/call` request's `_meta.progressToken` field. If the client doesn't provide a progress token, `reportProgress` is a no-op.

### Cancellation Support

Tools that declare `cancellable: true` receive an `AbortSignal` in their handler context. When the client sends a `notifications/cancelled` message, the signal fires.

```ts
server.tool('long-analysis', {
  description: 'Run complex analysis',
  input: z.object({ dataset: z.string() }),
  cancellable: true,
  handler: async ({ input, env, signal }) => {
    const chunks = await getDataChunks(env, input.dataset)
    const results = []

    for (const chunk of chunks) {
      if (signal.aborted) {
        return { results, partial: true, reason: 'cancelled' }
      }
      results.push(await processChunk(chunk))
    }

    return { results, partial: false }
  },
})
```

**Implementation:** The server maintains a `Map<requestId, AbortController>` in the session DO. When `notifications/cancelled` arrives with a `requestId`, the corresponding controller is aborted.

### Logging Integration

The MCP spec defines logging notifications (`notifications/message`) with levels: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`. These map to `@workkit/logger` levels:

| MCP Level | @workkit/logger Level | Notes |
|-----------|----------------------|-------|
| debug | debug | |
| info | info | |
| notice | info | Mapped to info (logger has no notice) |
| warning | warn | |
| error | error | |
| critical | error | Mapped to error with `critical: true` field |
| alert | error | Mapped to error with `alert: true` field |
| emergency | error | Mapped to error with `emergency: true` field |

When a client sends `logging/setLevel`, all subsequent log calls from tool handlers that meet the threshold are forwarded as MCP notifications.

```ts
// Internal: the logger proxy that also sends MCP notifications
function createMCPLogger(
  baseLogger: Logger,
  session: MCPSession | null,
  minLevel: LogLevel,
): Logger {
  return new Proxy(baseLogger, {
    get(target, prop) {
      if (['debug', 'info', 'warn', 'error'].includes(prop as string)) {
        return (...args: unknown[]) => {
          // Always log to Workers Logs
          (target as any)[prop](...args)
          // If session active and level meets threshold, send MCP notification
          if (session && levelMeetsThreshold(prop as string, minLevel)) {
            session.sendNotification('notifications/message', {
              level: mapToMCPLevel(prop as string),
              logger: target.name ?? 'tool',
              data: args[0],
            })
          }
        }
      }
      return (target as any)[prop]
    },
  })
}
```

---

## 4. REST API Generation

### URL Pattern

Every tool registered with `server.tool()` automatically gets a REST endpoint:

```
POST {basePath}/tools/{toolName}
```

Default `basePath` is `/api`, so:

| Tool Name | REST Endpoint |
|-----------|---------------|
| `search` | `POST /api/tools/search` |
| `create-user` | `POST /api/tools/create-user` |
| `db.query` | `POST /api/tools/db.query` |

All tools use POST regardless of their side effects. This is intentional — MCP tools are RPC-style invocations, not REST resources. The REST layer is a convenience bridge, not a RESTful API.

### Request Format

```http
POST /api/tools/search HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJ...

{
  "query": "cloudflare workers",
  "limit": 10
}
```

The request body IS the tool input. No wrapping. The body is validated against the tool's `input` schema.

### Response Format

**Success (200):**

```json
{
  "result": {
    "results": [
      { "title": "Getting Started", "snippet": "...", "score": 0.95 }
    ],
    "total": 1
  }
}
```

The handler's return value is wrapped in `{ result: ... }`. This matches the MCP `tools/call` response shape (`{ content: [...] }`) structurally — the REST layer wraps in `result`, the MCP layer wraps in `content` as text JSON.

**Validation Error (400):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "issues": [
      { "path": ["query"], "message": "Required" }
    ]
  }
}
```

Consistent with `@workkit/errors` `ValidationError` → `errorToResponse()`.

**Auth Error (401):**

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing authentication token"
  }
}
```

**Rate Limit (429):**

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 30
  }
}
```

Headers include `Retry-After` and standard rate limit headers from `@workkit/ratelimit`.

**Tool Error (500):**

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Tool execution failed"
  }
}
```

In development mode (`NODE_ENV !== 'production'`), includes `stack` and `cause` fields.

### OpenAPI 3.1 Spec Generation

Served at `GET /openapi.json` (configurable). Generated once at `.serve()` time and cached.

```ts
// Internal: how tool definitions map to OpenAPI
function toolToOpenAPIOperation(name: string, tool: RegisteredTool): OpenAPIOperation {
  return {
    operationId: `tool_${name}`,
    summary: tool.description,
    tags: tool.tags ?? ['tools'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: schemaToJsonSchema(tool.input),
        },
      },
    },
    responses: {
      '200': {
        description: 'Tool execution result',
        content: {
          'application/json': {
            schema: tool.output
              ? { type: 'object', properties: { result: schemaToJsonSchema(tool.output) } }
              : { type: 'object', properties: { result: {} } },
          },
        },
      },
      '400': { $ref: '#/components/responses/ValidationError' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '429': { $ref: '#/components/responses/RateLimited' },
      '500': { $ref: '#/components/responses/InternalError' },
    },
  }
}
```

The full OpenAPI spec includes shared error response components, security schemes (when auth is configured), and server URLs.

### Swagger UI

When `openapi.swaggerUI` is enabled, a Swagger UI page is served at `GET /api/docs`. The `swaggerUI` option accepts either a boolean or a configuration object:

- `swaggerUI: true` or `swaggerUI: { cdn: true }` (default) — loads Swagger UI assets from unpkg.com CDN. Zero bundle size impact, but requires internet access.
- `swaggerUI: { bundle: true }` — serves Swagger UI from a bundled version included in the package. Adds ~1.5MB to the Worker bundle but works in air-gapped environments and eliminates CDN latency.

```ts
// Internal: Swagger UI handler with source selection
function swaggerUIHandler(specUrl: string, options: { cdn?: boolean; bundle?: boolean }): Response {
  const assets = options.bundle ? bundledSwaggerUI : cdnSwaggerUI
  return new Response(swaggerUIHTML(specUrl, assets), {
    headers: { 'Content-Type': 'text/html' },
  })
}
```

---

## 5. Middleware System

### How Middleware Works

Middleware follows the exact same pattern as `@workkit/api`:

```ts
type Middleware<TEnv = unknown> = (
  request: Request,
  env: TEnv,
  next: MiddlewareNext,
) => MaybePromise<Response>
```

**Execution order:**

```
Server-level middleware → Tool-level middleware → Handler
        ↓                       ↓                  ↓
   (e.g., logger)        (e.g., rateLimit)     (your code)
        ↓                       ↓                  ↓
   Response flows back ← Response flows back ← Return value
```

Middleware can:
- Short-circuit (return a Response without calling `next()`)
- Transform the request before passing to `next()`
- Transform the response after `next()` returns
- Add headers, log, measure timing, etc.

**Middleware applies to REST endpoints only.** MCP protocol messages bypass middleware and go directly to the handler. This is by design — MCP clients handle auth at the transport level (via headers on the HTTP connection), and rate limiting MCP calls would break the protocol's streaming semantics.

If you need pre-handler logic that runs on BOTH paths, use the `handler` itself — check `ctx.request.headers` or implement guards inline.

### Integration with Existing workkit Middleware

Every existing `@workkit/api` middleware works unchanged:

```ts
import { createMCPServer } from '@workkit/mcp'
import { rateLimit } from '@workkit/hono'
import { createAuthHandler, extractBearerToken, verifyJWT } from '@workkit/auth'
import { logger } from '@workkit/logger'
import { z } from 'zod'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
  middleware: [
    // Server-level: applied to all REST endpoints
    loggerMiddleware(),
  ],
})

server.tool('public-search', {
  description: 'Public search — no auth required',
  input: z.object({ query: z.string() }),
  handler: async ({ input, env }) => {
    return { results: [] }
  },
})

server.tool('admin-action', {
  description: 'Admin-only tool',
  input: z.object({ action: z.string() }),
  middleware: [
    // Tool-level: only this REST endpoint
    requireAuth(),
    rateLimitPerUser({ limit: 10, window: '1m' }),
  ],
  handler: async ({ input, env }) => {
    return { done: true }
  },
})
```

### Auth Middleware Patterns

**Bearer token (JWT):**

```ts
import { verifyJWT, extractBearerToken } from '@workkit/auth'

function requireAuth(): Middleware<Env> {
  return async (request, env, next) => {
    const token = extractBearerToken(request)
    if (!token) {
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const result = await verifyJWT(token, env.JWT_SECRET)
    if (!result.valid) {
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Attach user info to request for downstream use
    // (Use a WeakMap or header since Middleware doesn't have a shared context object)
    request.headers.set('X-User-Id', result.payload.sub ?? '')
    return next()
  }
}
```

**API key:**

```ts
function requireApiKey(): Middleware<Env> {
  return async (request, env, next) => {
    const key = request.headers.get('X-API-Key')
    if (!key || key !== env.API_KEY) {
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return next()
  }
}
```

### Rate Limiting Per Tool

```ts
import { fixedWindow } from '@workkit/ratelimit'
import { rateLimitHeaders, rateLimitResponse } from '@workkit/ratelimit'

function rateLimitPerUser(opts: { limit: number; window: string }): Middleware<Env> {
  return async (request, env, next) => {
    const userId = request.headers.get('X-User-Id') ?? 'anonymous'
    const limiter = fixedWindow({
      limit: opts.limit,
      window: opts.window,
      storage: env.KV,
      key: `ratelimit:${userId}`,
    })

    const result = await limiter.check()
    if (!result.allowed) {
      return rateLimitResponse(result)
    }

    const response = await next()
    // Add rate limit headers to successful responses
    const headers = rateLimitHeaders(result)
    for (const [k, v] of Object.entries(headers)) {
      response.headers.set(k, v)
    }
    return response
  }
}
```

### Custom Middleware Interface

For middleware that needs to participate in both MCP and REST paths, implement a tool-level guard instead:

```ts
server.tool('guarded-tool', {
  description: 'Tool with custom guard logic',
  input: z.object({ data: z.string() }),
  handler: async ({ input, env, request }) => {
    // This runs on BOTH MCP and REST paths
    const userAgent = request.headers.get('User-Agent') ?? ''
    if (userAgent.includes('banned-client')) {
      throw new ForbiddenError('Client not allowed')
    }

    return { processed: true }
  },
})
```

---

## 6. Edge Cases & Error Handling

### Tool Handler Throws

**Scenario:** A tool handler throws an unexpected error.

**MCP path:** The error is caught, logged, and returned as a JSON-RPC error response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "Internal error: [sanitized message]" }],
    "isError": true
  }
}
```

Per the MCP spec, tool errors use `isError: true` in the result, NOT a JSON-RPC error. JSON-RPC errors are reserved for protocol-level failures (invalid method, malformed request).

If the thrown error is a `WorkkitError`, the code and message are preserved. Unknown errors get a generic message in production.

**REST path:** The error flows through `@workkit/errors` `errorToResponse()`:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Tool execution failed"
  }
}
```

Status code: `WorkkitError` subclasses map to their HTTP codes (400, 401, 403, 404, 409, 429, 500, 503). Unknown errors → 500.

### Input Validation Fails

**MCP path:** Returns a JSON-RPC result with `isError: true`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "Validation error: query is required, limit must be a number"
    }],
    "isError": true
  }
}
```

**REST path:** Returns 400 with structured error body (same format as `@workkit/api` validation errors).

**Both paths** use the same validation function from `@workkit/api`:

```ts
import { validate } from '@workkit/api'

// In tool execution:
const validatedInput = await validate(tool.input, rawInput, 'tool input')
```

### Middleware Rejects

**Auth failure:** Middleware returns 401 directly. Only affects REST path (MCP bypasses middleware).

**Rate limit:** Middleware returns 429 with `Retry-After` header and rate limit headers.

**Custom rejection:** Any middleware can short-circuit with any Response.

None of these affect MCP protocol messages. MCP auth is handled at the transport level by the client including auth headers on the HTTP request itself.

### Timeout Handling

Each tool has a configurable timeout (default: 25,000ms — 5s safety margin under CF's 30s CPU limit).

```ts
// Internal: timeout wrapper
async function executeWithTimeout<T>(
  handler: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const controller = new AbortController()

  // Link to parent signal (cancellation)
  signal.addEventListener('abort', () => controller.abort(signal.reason))

  const timeout = setTimeout(() => {
    controller.abort(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    const result = await handler()
    return result
  } finally {
    clearTimeout(timeout)
  }
}
```

When a timeout fires:
- **MCP path:** Returns `isError: true` with timeout message
- **REST path:** Returns 504 Gateway Timeout with `TimeoutError` body

### Concurrent Tool Calls

The MCP spec allows clients to send multiple `tools/call` requests without waiting for responses (pipelining). On Workers, each request is handled independently — V8 isolates handle concurrent requests naturally.

**Concern:** Multiple concurrent calls to the same tool that share state (e.g., via DO) could race. This is the developer's responsibility — use `typedStorage` transactions or DO alarm coalescing from `@workkit/do`.

**Implementation:** The Streamable HTTP transport parses each JSON-RPC message independently. If a client sends a batch (`[{...}, {...}]`), each message is processed concurrently and results are returned as a batch response.

**Batch processing details:** Batch requests are processed using `Promise.allSettled()` — each tool call runs with its own per-tool timeout (from `ToolConfig.timeout`). The total batch execution is bounded by the Worker's wall-clock limit (30s CPU on paid plan). Batch size is configurable via `MCPServerConfig.maxBatchSize` (default: 10). Batches exceeding this limit receive a JSON-RPC error (`-32600 Invalid Request`) without processing any items. Each item in the batch settles independently — a timeout or failure in one tool call does not cancel others.

### Large Response Payloads (Streaming)

**REST path:** If a tool handler returns a `ReadableStream`, it's passed through as a streaming response:

```ts
server.tool('export-data', {
  description: 'Export large dataset',
  input: z.object({ format: z.enum(['csv', 'json']) }),
  handler: async ({ input, env }) => {
    // Return a stream — bypasses JSON serialization
    const stream = createExportStream(env.DB, input.format)
    return new Response(stream, {
      headers: { 'Content-Type': input.format === 'csv' ? 'text/csv' : 'application/json' },
    })
  },
})
```

**MCP path:** MCP tool responses must be `TextContent` or `ImageContent`. Large text payloads are sent as-is (the MCP client handles buffering). For truly massive responses (>5MB), consider returning a resource URI instead:

```ts
handler: async ({ input, env }) => {
  const key = `exports/${crypto.randomUUID()}.csv`
  await env.R2.put(key, exportData)
  // Return a URI the client can fetch separately
  return { downloadUri: `https://cdn.example.com/${key}`, expiresIn: 3600 }
}
```

### Tool Name Collisions

Calling `server.tool()` with a duplicate name throws at registration time (not at request time):

```ts
server.tool('search', { ... })
server.tool('search', { ... }) // throws: Tool "search" already registered
```

This is a loud, immediate failure. No silent overwrites.

### Schema Version Migration

When a tool's input schema changes between versions:

**MCP clients:** Will call `tools/list` and get the updated schema. Well-behaved clients re-fetch the tool list on reconnect. The `listChanged` capability tells the client to poll for updates.

**REST clients:** Hit the updated `POST /api/tools/{name}` endpoint. If they send old-format data, validation fails with a 400 explaining which fields are wrong.

**Recommendation:** For breaking schema changes, version the tool name: `search-v2`. Keep `search` for backward compatibility with a deprecation warning logged to MCP notifications.

### Client Disconnection Mid-Execution

**REST path:** The Workers runtime detects TCP disconnection. The handler continues running (Workers don't abort on disconnect). Use `waitUntil` for cleanup:

```ts
handler: async ({ input, env, ctx }) => {
  const result = await doWork(input)
  ctx.waitUntil(cleanupResources(env))
  return result
}
```

**MCP path (Streamable HTTP):** If the client disconnects during a streaming response, the SSE write will fail. The `signal` passed to the handler fires `abort`. Tools that check `signal.aborted` can exit early.

**MCP path (SSE):** SSE connection drop is detected by the server. Pending progress notifications are discarded. The session DO cleans up on its TTL alarm.

### Memory Limits (128MB V8 Isolate)

Workers have a 128MB memory limit per isolate. Large schemas, many tools, or in-memory caches can approach this.

**Mitigations built into @workkit/mcp:**
- OpenAPI spec is generated once and cached as a string (not kept as a live object graph)
- Tool registries use `Map` (not nested objects) for O(1) lookup
- Schema introspection for OpenAPI/JSON Schema conversion is lazy (computed on first `/openapi.json` request)
- No in-memory tool result caching (use KV or R2 if you need caching)

**Developer guidance:** If your MCP server has >100 tools, profile memory usage. Consider splitting into multiple Workers (one per domain) and using a gateway pattern.

---

## 7. Testing Story

### Unit Testing Tool Handlers

```ts
import { describe, it, expect } from 'vitest'
import { createMCPTestClient } from '@workkit/mcp/testing'
import { createTestEnv } from '@workkit/testing'
import { server } from './server'

describe('search tool', () => {
  it('returns matching results', async () => {
    const env = createTestEnv({
      DB: createMockD1([
        { title: 'Getting Started', snippet: '...', score: 0.95 },
      ]),
    })

    const client = createMCPTestClient(server, env)

    // Test via MCP protocol
    const mcpResult = await client.callTool('search', {
      query: 'getting started',
      limit: 10,
    })

    expect(mcpResult.content[0].text).toContain('Getting Started')
    expect(mcpResult.isError).toBeUndefined()
  })

  it('validates input', async () => {
    const client = createMCPTestClient(server, createTestEnv())

    const result = await client.callTool('search', {
      query: '',  // min(1) fails
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('query')
  })
})
```

### Testing REST Endpoints

```ts
import { createRequest } from '@workkit/testing'

describe('search REST endpoint', () => {
  it('POST /api/tools/search returns results', async () => {
    const env = createTestEnv({ DB: createMockD1([...]) })
    const worker = server.serve()

    const request = createRequest('/api/tools/search', {
      method: 'POST',
      body: { query: 'hello', limit: 5 },
      headers: { 'Authorization': 'Bearer test-token' },
    })

    const response = await worker.fetch(request, env, createExecutionContext())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.results).toHaveLength(1)
  })

  it('returns 400 for invalid input', async () => {
    const worker = server.serve()

    const request = createRequest('/api/tools/search', {
      method: 'POST',
      body: { limit: 'not-a-number' },
    })

    const response = await worker.fetch(request, env, createExecutionContext())

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})
```

### Testing MCP Protocol Messages Directly

```ts
describe('MCP protocol', () => {
  it('handles initialize handshake', async () => {
    const worker = server.serve()

    const request = createRequest('/mcp', {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
    })

    const response = await worker.fetch(request, env, createExecutionContext())
    const body = await response.json()

    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('my-tools')
  })

  it('tools/list returns all registered tools', async () => {
    const client = createMCPTestClient(server, env)

    const tools = await client.listTools()

    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('search')
    expect(tools[0].inputSchema).toBeDefined()
  })
})
```

### The `createMCPTestClient` API

```ts
interface MCPTestClient {
  /** Call a tool and get the MCP-formatted result */
  callTool(name: string, input: unknown): Promise<CallToolResult>

  /** List all tools */
  listTools(): Promise<Tool[]>

  /** Read a resource */
  readResource(uri: string): Promise<ReadResourceResult>

  /** List all resources */
  listResources(): Promise<Resource[]>

  /** Get a prompt */
  getPrompt(name: string, args?: unknown): Promise<GetPromptResult>

  /** List all prompts */
  listPrompts(): Promise<Prompt[]>

  /** Send a raw JSON-RPC request */
  raw(method: string, params?: unknown): Promise<unknown>

  /** Call a tool via the REST endpoint */
  rest(name: string, input: unknown, headers?: Record<string, string>): Promise<Response>
}
```

---

## 8. Cloudflare-Specific Considerations

### Worker Size Limits

| Plan | Compressed Size | Uncompressed |
|------|----------------|--------------|
| Free | 1 MB | 10 MB |
| Paid | 10 MB | — |

**@workkit/mcp budget estimate:**
- Core runtime (transport, routing, validation, OpenAPI gen): ~15 KB minified + gzipped
- Swagger UI (if enabled, loaded from CDN — zero bundle impact): 0 KB
- Zod (if used by developer): ~13 KB gzipped
- Total framework overhead: ~15-20 KB gzipped

This is well within limits. Tree-shaking ensures unused features (SSE transport, Swagger UI HTML, session DO class) are excluded.

### Execution Time Limits

| Plan | CPU Time | Wall Clock |
|------|----------|------------|
| Free | 10 ms | 30 s |
| Paid | 30 s | 15 min |

**Default tool timeout:** 25,000ms (25s) — leaves a 5s buffer under the 30s CPU limit on paid plans.

**For long-running tools (>30s):** Use a Durable Object as the execution environment. The DO has a 30s wall-clock limit per `fetch`, but can use alarms for multi-step processing. Pattern:

```ts
server.tool('long-job', {
  description: 'Submit a long-running job',
  input: z.object({ data: z.string() }),
  handler: async ({ input, env, ctx }) => {
    // Submit to DO, return immediately with job ID
    const id = env.JOBS.idFromName(crypto.randomUUID())
    const stub = env.JOBS.get(id)
    await stub.fetch(new Request('https://internal/start', {
      method: 'POST',
      body: JSON.stringify(input),
    }))

    return { jobId: id.toString(), status: 'submitted' }
  },
})
```

### DO-Backed Session State

The `MCPSessionDO` class is exported from `@workkit/mcp` for developers who enable stateful sessions:

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "MCP_SESSIONS"
class_name = "MCPSessionDO"

[[migrations]]
tag = "v1"
new_classes = ["MCPSessionDO"]
```

```ts
// worker.ts
import { createMCPServer, MCPSessionDO } from '@workkit/mcp'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
  session: { storage: 'durable-object' },
})

// Export the DO class alongside the worker
export { MCPSessionDO }
export default server.serve()
```

The DO internally uses `@workkit/do` primitives:

```ts
// Internal implementation sketch
import { typedStorage, scheduleAlarm } from '@workkit/do'

export class MCPSessionDO implements DurableObject {
  private storage: TypedStorageWrapper

  constructor(private state: DurableObjectState, private env: Env) {
    this.storage = typedStorage(state.storage)
  }

  async fetch(request: Request): Promise<Response> {
    // Route session-scoped MCP messages
    // Track subscriptions, progress tokens, cancellation
  }

  async alarm(): Promise<void> {
    // TTL expiry — delete session state
    await this.state.storage.deleteAll()
  }
}
```

### Workers AI Integration

Tools can call Workers AI models directly via bindings:

```ts
type Env = {
  AI: Ai
  DB: D1Database
}

server.tool('summarize-text', {
  description: 'Summarize text using AI',
  input: z.object({ text: z.string().max(10000) }),
  output: z.object({ summary: z.string() }),
  annotations: { readOnlyHint: true },
  handler: async ({ input, env }) => {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Summarize the following text concisely.' },
        { role: 'user', content: input.text },
      ],
    })

    return { summary: result.response }
  },
})
```

For more complex AI pipelines, use `@workkit/ai`:

```ts
import { ai, fallback, withRetry } from '@workkit/ai'

server.tool('smart-search', {
  description: 'AI-powered semantic search',
  input: z.object({ query: z.string() }),
  handler: async ({ input, env }) => {
    const client = ai(env.AI)

    // Generate embedding with fallback
    const embedding = await fallback(
      () => client.run('@cf/baai/bge-large-en-v1.5', { text: [input.query] }),
      () => client.run('@cf/baai/bge-base-en-v1.5', { text: [input.query] }),
    )

    // Vector search
    const results = await env.VECTORIZE.query(embedding.data[0], { topK: 10 })
    return { results }
  },
})
```

### Bindings Pattern

The `TEnv` generic flows from `createMCPServer` through to every handler:

```ts
type Env = {
  DB: D1Database
  KV: KVNamespace
  R2: R2Bucket
  AI: Ai
  QUEUE: Queue
  SESSIONS: DurableObjectNamespace  // For MCPSessionDO
  JWT_SECRET: string
  API_KEY: string
}

const server = createMCPServer<Env>({
  name: 'my-tools',
  version: '1.0.0',
})

// All handlers get typed `env`:
server.tool('query', {
  input: z.object({ sql: z.string() }),
  description: 'Run a D1 query',
  handler: async ({ input, env }) => {
    // env.DB is D1Database — fully typed
    const result = await env.DB.prepare(input.sql).all()
    return { rows: result.results }
  },
})
```

---

## 9. CLI Integration

### `npx workkit create my-tools --template mcp`

Scaffolds a new MCP server project:

```
my-tools/
  src/
    index.ts          # Server definition with example tool
    tools/
      hello.ts        # Example tool module
    env.ts            # Env type definition
  test/
    tools/
      hello.test.ts   # Example test
  wrangler.toml       # CF Workers config (with DO binding if stateful)
  package.json        # Dependencies: @workkit/mcp, zod, vitest
  tsconfig.json       # Strict TS config
  .dev.vars           # Local env vars
  README.md           # Getting started guide
```

**Generated `src/index.ts`:**

```ts
import { createMCPServer } from '@workkit/mcp'
import type { Env } from './env'
import { helloTool } from './tools/hello'

const server = createMCPServer<Env>({
  name: 'my-tools',
  version: '0.1.0',
  description: 'My MCP tool server',
  openapi: { swaggerUI: true },
  cors: true,
})

helloTool(server)

export default server.serve()
```

**Generated `src/tools/hello.ts`:**

```ts
import { z } from 'zod'
import type { MCPServer } from '@workkit/mcp'
import type { Env } from '../env'

export function helloTool(server: MCPServer<Env>) {
  server.tool('hello', {
    description: 'Say hello to someone',
    input: z.object({
      name: z.string().describe('Name of the person to greet'),
    }),
    output: z.object({
      message: z.string(),
    }),
    handler: ({ input }) => ({
      message: `Hello, ${input.name}!`,
    }),
  })
}
```

### `workkit add mcp`

For existing workkit projects, adds MCP dependencies and scaffolds the entry point:

```bash
npx workkit add mcp
```

This:
1. Installs `@workkit/mcp` and `@modelcontextprotocol/sdk` (peer dep)
2. Creates `src/mcp.ts` with a basic server setup
3. Updates `wrangler.toml` if DO bindings are needed
4. Prints next-steps guide

---

## 10. Migration Path

### From `@modelcontextprotocol/sdk`

**Before (raw SDK):**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'my-tools',
  version: '1.0.0',
})

server.tool('search', { query: z.string(), limit: z.number() }, async (args) => {
  const results = await doSearch(args.query, args.limit)
  return {
    content: [{ type: 'text', text: JSON.stringify(results) }],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
```

**After (@workkit/mcp):**

```ts
import { createMCPServer } from '@workkit/mcp'
import { z } from 'zod'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
})

server.tool('search', {
  description: 'Search the knowledge base',
  input: z.object({ query: z.string(), limit: z.number() }),
  output: z.object({ results: z.array(z.string()), total: z.number() }),
  handler: async ({ input, env }) => {
    const results = await doSearch(input.query, input.limit)
    return { results, total: results.length }
  },
})

export default server.serve()
```

**What changes:**
- `new McpServer` → `createMCPServer` (factory, not class)
- Inline schema args → `{ input: z.object({...}) }` (explicit input object)
- Raw `content` array → return plain objects (serialization handled by framework)
- `StdioServerTransport` → `server.serve()` (transport is automatic)
- No `await server.connect()` — Workers don't have a persistent process
- **Gained:** REST endpoint, OpenAPI spec, input/output validation, middleware, typed env bindings

### From FastMCP

**Before (FastMCP):**

```ts
import { FastMCP } from 'fastmcp'
import { z } from 'zod'

const server = new FastMCP({ name: 'my-tools', version: '1.0.0' })

server.addTool({
  name: 'search',
  description: 'Search the knowledge base',
  parameters: z.object({ query: z.string() }),
  execute: async (args) => {
    return JSON.stringify(await doSearch(args.query))
  },
})

server.start({ transportType: 'sse' })
```

**After (@workkit/mcp):**

```ts
import { createMCPServer } from '@workkit/mcp'
import { z } from 'zod'

const server = createMCPServer({
  name: 'my-tools',
  version: '1.0.0',
})

server.tool('search', {
  description: 'Search the knowledge base',
  input: z.object({ query: z.string() }),
  handler: async ({ input }) => {
    return await doSearch(input.query)  // Return object, not JSON string
  },
})

export default server.serve()
```

**What changes:**
- `new FastMCP` → `createMCPServer`
- `server.addTool({ parameters, execute })` → `server.tool(name, { input, handler })`
- `execute: (args) =>` → `handler: ({ input }) =>` (destructured context, not raw args)
- Return objects, not `JSON.stringify(...)` — serialization is handled
- `server.start({ transportType })` → `server.serve()` — transport auto-detected
- **Gained:** Type-safe output schemas, REST endpoints, OpenAPI, CF Workers native

### Gradual Adoption (Alongside Existing Hono App)

If you already have a Hono app and want to add MCP capabilities without rewriting:

```ts
import { Hono } from 'hono'
import { createMCPServer } from '@workkit/mcp'
import { z } from 'zod'

// Existing Hono app
const app = new Hono<{ Bindings: Env }>()
app.get('/users/:id', async (c) => { ... })
app.post('/users', async (c) => { ... })

// MCP server for tool access
const mcp = createMCPServer<Env>({
  name: 'my-tools',
  version: '1.0.0',
})

mcp.tool('get-user', {
  description: 'Get a user by ID',
  input: z.object({ id: z.string() }),
  handler: async ({ input, env }) => {
    return await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(input.id).first()
  },
})

// Mount MCP into the existing app
const { mcpHandler, restHandler, openapi } = mcp.mount()

app.post('/mcp', async (c) => {
  return mcpHandler(c.req.raw, c.env)
})

app.get('/mcp', async (c) => {
  return mcpHandler(c.req.raw, c.env)
})

app.post('/api/tools/:name', async (c) => {
  return restHandler(c.req.raw, c.env)
})

app.get('/openapi.json', (c) => {
  return c.json(openapi())
})

export default app
```

This pattern lets you incrementally add MCP tools to an existing API without changing your deployment model. The MCP server doesn't own the Worker — your Hono app does.

---

## Appendix A: Complete Example — Production MCP Server

```ts
// src/index.ts
import { createMCPServer } from '@workkit/mcp'
import { z } from 'zod'

type Env = {
  DB: D1Database
  KV: KVNamespace
  AI: Ai
  JWT_SECRET: string
  MCP_SESSIONS: DurableObjectNamespace
}

const server = createMCPServer<Env>({
  name: 'knowledge-base',
  version: '1.0.0',
  description: 'Knowledge base tools for AI assistants',
  instructions: 'Always use the search tool before answering questions. Use get-document to retrieve full content.',
  cors: true,
  auth: {
    type: 'bearer',
    jwt: { algorithms: ['HS256'] },
  },
  session: { storage: 'durable-object', ttl: 1800 },
  openapi: { swaggerUI: true },
})

// --- Tools ---

server.tool('search', {
  description: 'Search the knowledge base by query. Returns ranked results with snippets.',
  input: z.object({
    query: z.string().min(1).max(500).describe('Search query'),
    limit: z.number().int().min(1).max(50).default(10).describe('Max results'),
    category: z.string().optional().describe('Filter by category'),
  }),
  output: z.object({
    results: z.array(z.object({
      id: z.string(),
      title: z.string(),
      snippet: z.string(),
      score: z.number(),
      category: z.string(),
    })),
    total: z.number(),
    queryTimeMs: z.number(),
  }),
  annotations: { readOnlyHint: true },
  tags: ['search'],
  handler: async ({ input, env, log }) => {
    const start = Date.now()
    log.info({ query: input.query, limit: input.limit }, 'executing search')

    let sql = 'SELECT * FROM documents WHERE content MATCH ?1'
    const bindings: unknown[] = [input.query]

    if (input.category) {
      sql += ' AND category = ?2'
      bindings.push(input.category)
    }

    sql += ' ORDER BY rank LIMIT ?3'
    bindings.push(input.limit)

    const result = await env.DB.prepare(sql).bind(...bindings).all()

    return {
      results: result.results.map((r: any) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
        category: r.category,
      })),
      total: result.results.length,
      queryTimeMs: Date.now() - start,
    }
  },
})

server.tool('get-document', {
  description: 'Retrieve full document content by ID.',
  input: z.object({
    id: z.string().describe('Document ID'),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    category: z.string(),
    updatedAt: z.string(),
  }),
  annotations: { readOnlyHint: true },
  tags: ['documents'],
  handler: async ({ input, env }) => {
    const doc = await env.DB.prepare(
      'SELECT * FROM documents WHERE id = ?'
    ).bind(input.id).first()

    if (!doc) {
      throw new NotFoundError(`Document ${input.id} not found`)
    }

    return doc as any
  },
})

server.tool('ask', {
  description: 'Ask a question about the knowledge base. Uses AI to generate an answer from relevant documents.',
  input: z.object({
    question: z.string().min(1).max(1000),
  }),
  output: z.object({
    answer: z.string(),
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  annotations: { readOnlyHint: true },
  tags: ['ai'],
  timeout: 15_000,
  handler: async ({ input, env, log }) => {
    // 1. Search for relevant documents
    const searchResult = await env.DB.prepare(
      'SELECT id, title, content FROM documents WHERE content MATCH ?1 LIMIT 5'
    ).bind(input.question).all()

    const context = searchResult.results
      .map((r: any) => `## ${r.title}\n${r.content}`)
      .join('\n\n')

    // 2. Generate answer with Workers AI
    const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: `Answer the question based on the provided context. If the context doesn't contain the answer, say so.\n\nContext:\n${context}`,
        },
        { role: 'user', content: input.question },
      ],
    })

    return {
      answer: aiResult.response,
      sources: searchResult.results.map((r: any) => ({
        id: r.id,
        title: r.title,
      })),
    }
  },
})

// --- Resources ---

server.resource('stats://knowledge-base', {
  description: 'Knowledge base statistics',
  mimeType: 'application/json',
  handler: async ({ env }) => {
    const stats = await env.DB.prepare(
      'SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories FROM documents'
    ).first()

    return {
      contents: [{
        uri: 'stats://knowledge-base',
        mimeType: 'application/json',
        text: JSON.stringify(stats),
      }],
    }
  },
})

// --- Prompts ---

server.prompt('research', {
  description: 'Research a topic using the knowledge base',
  args: z.object({
    topic: z.string().describe('The topic to research'),
    depth: z.enum(['shallow', 'deep']).default('shallow'),
  }),
  handler: async ({ args }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: args.depth === 'deep'
            ? `Research "${args.topic}" thoroughly. Use the search tool multiple times with different queries. Get full documents for the most relevant results. Synthesize a comprehensive answer.`
            : `Briefly research "${args.topic}". Use the search tool once and summarize the top results.`,
        },
      },
    ],
  }),
})

// --- Export ---

import { MCPSessionDO } from '@workkit/mcp'
export { MCPSessionDO }
export default server.serve()
```

## Appendix B: Package Dependencies

```json
{
  "name": "@workkit/mcp",
  "peerDependencies": {
    "hono": ">=4.0.0"
  },
  "dependencies": {
    "@workkit/api": "workspace:*",
    "@workkit/errors": "workspace:*",
    "@workkit/logger": "workspace:*",
    "@workkit/types": "workspace:*"
  },
  "optionalDependencies": {
    "@workkit/do": "workspace:*",
    "@workkit/auth": "workspace:*",
    "@workkit/ratelimit": "workspace:*"
  }
}
```

`@workkit/do` is optional — only needed when `session.storage: 'durable-object'` is configured. `@workkit/auth` and `@workkit/ratelimit` are optional — only needed when their middleware is used. Core functionality (tools, REST, OpenAPI) has minimal dependencies.

## Appendix C: File Structure

```
packages/mcp/
  src/
    index.ts                # Public API exports
    server.ts               # createMCPServer factory
    types.ts                # All public TypeScript types
    registry.ts             # Tool/Resource/Prompt registries
    transport/
      streamable-http.ts    # Streamable HTTP transport
      sse.ts                # SSE transport (legacy)
      jsonrpc.ts            # JSON-RPC message parsing/serialization
    protocol/
      initialize.ts         # initialize/initialized handlers
      tools.ts              # tools/list, tools/call
      resources.ts          # resources/list, resources/read, subscriptions
      prompts.ts            # prompts/list, prompts/get
      logging.ts            # logging/setLevel, notification bridge
      completion.ts         # completion/complete autocomplete
    rest/
      router.ts             # REST endpoint generation from tool registry
      openapi.ts            # OpenAPI 3.1 spec generation
      swagger.ts            # Swagger UI HTML handler
    session/
      do.ts                 # MCPSessionDO Durable Object class
      manager.ts            # Session lifecycle management
    middleware/
      auth.ts               # Built-in auth middleware factory
      timeout.ts            # Tool execution timeout wrapper
    testing/
      client.ts             # createMCPTestClient
      index.ts              # Testing exports
  test/
    server.test.ts
    transport.test.ts
    protocol.test.ts
    rest.test.ts
    session.test.ts
    middleware.test.ts
```
