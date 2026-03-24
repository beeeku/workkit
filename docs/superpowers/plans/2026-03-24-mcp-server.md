# @workkit/mcp Implementation Plan — "Hono for MCP"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a type-safe MCP server framework for Cloudflare Workers that generates an MCP server, REST API, and OpenAPI spec from a single tool definition.

**Architecture:** Builder pattern — `createMCPServer()` returns a builder that accumulates tools/resources/prompts into internal registries. `.serve()` freezes registries and builds an internal Hono app with two routing paths (MCP JSON-RPC + REST HTTP) that converge at the same validated handler. Standard Schema v1 for input/output validation (Zod, Valibot, ArkType).

**Tech Stack:** TypeScript, Hono (internal router), Standard Schema v1, Vitest, bunup (build), @workkit/api (validation), @workkit/errors (error handling), @workkit/types (shared types)

**Spec:** `workkit/docs/superpowers/specs/2026-03-24-mcp-design.md`

**Existing patterns to follow:** `workkit/packages/api/` — same file structure (src/, tests/), vitest config, bunup config, tsconfig extending `../../tooling/tsconfig/library.json`, package.json exports map.

---

## File Structure

```
packages/mcp/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bunup.config.ts
├── src/
│   ├── index.ts              — Public exports
│   ├── types.ts              — All type definitions (MCPServerConfig, ToolConfig, etc.)
│   ├── server.ts             — createMCPServer() factory + builder
│   ├── registry.ts           — Tool/Resource/Prompt registries
│   ├── protocol.ts           — MCP JSON-RPC dispatcher (initialize, tools/call, etc.)
│   ├── transport.ts          — Streamable HTTP + SSE transport handlers
│   ├── rest.ts               — REST endpoint generation from tool registry
│   ├── openapi.ts            — OpenAPI 3.1 spec generation from tool registry
│   ├── validation.ts         — Standard Schema validation bridge (reuses @workkit/api)
│   ├── timeout.ts            — Tool execution timeout wrapper
│   └── errors.ts             — MCP-specific error mapping (WorkkitError → JSON-RPC)
├── tests/
│   ├── types.test.ts
│   ├── server.test.ts
│   ├── registry.test.ts
│   ├── protocol.test.ts
│   ├── transport.test.ts
│   ├── rest.test.ts
│   ├── openapi.test.ts
│   ├── validation.test.ts
│   ├── timeout.test.ts
│   ├── errors.test.ts
│   └── integration.test.ts
```

---

### Task 1: Package Scaffolding

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/vitest.config.ts`
- Create: `packages/mcp/bunup.config.ts`
- Create: `packages/mcp/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@workkit/mcp",
  "version": "0.1.0",
  "description": "Hono for MCP — type-safe MCP servers on Cloudflare Workers with REST + OpenAPI from one definition",
  "license": "MIT",
  "author": "Bikash Dash <beeeku>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/beeeku/workkit.git",
    "directory": "packages/mcp"
  },
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "sideEffects": false,
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "bunup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@workkit/errors": "workspace:*",
    "hono": "^4.7.10"
  },
  "devDependencies": {
    "@workkit/types": "workspace:*",
    "@cloudflare/workers-types": "^4.20250214.0",
    "zod": "^4.3.6"
  },
  "keywords": [
    "cloudflare", "workers", "mcp", "model-context-protocol",
    "ai", "tools", "openapi", "workkit"
  ]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tooling/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create bunup.config.ts**

```ts
import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: "linked",
  clean: true,
  external: ["@workkit/types", "@workkit/errors", "hono"],
});
```

- [ ] **Step 5: Create empty src/index.ts**

```ts
// @workkit/mcp — "Hono for MCP"
// Exports are added as modules are implemented.
```

- [ ] **Step 6: Install dependencies**

Run: `cd packages/mcp && bun install`
Expected: Dependencies installed, lockfile updated.

- [ ] **Step 7: Verify build scaffolding**

Run: `cd packages/mcp && bun run build`
Expected: Clean build to dist/, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/vitest.config.ts packages/mcp/bunup.config.ts packages/mcp/src/index.ts
git commit -m "feat(mcp): scaffold @workkit/mcp package"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `packages/mcp/src/types.ts`
- Test: `packages/mcp/tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import type {
  MCPServerConfig,
  ToolConfig,
  ToolHandlerContext,
  ResourceConfig,
  PromptConfig,
  StandardSchemaV1,
  InferOutput,
  ToolAnnotations,
  MCPSessionConfig,
  MCPAuthConfig,
  Middleware,
  MiddlewareNext,
  WorkerModule,
} from "../src/types";

describe("types", () => {
  it("MCPServerConfig accepts minimal config", () => {
    const config: MCPServerConfig = {
      name: "test",
      version: "1.0.0",
    };
    expectTypeOf(config.name).toBeString();
    expectTypeOf(config.version).toBeString();
  });

  it("ToolConfig infers input/output types from Zod schemas", () => {
    const input = z.object({ query: z.string() });
    const output = z.object({ results: z.array(z.string()) });

    type InputType = InferOutput<typeof input>;
    type OutputType = InferOutput<typeof output>;

    expectTypeOf<InputType>().toEqualTypeOf<{ query: string }>();
    expectTypeOf<OutputType>().toEqualTypeOf<{ results: string[] }>();
  });

  it("ToolAnnotations has correct shape", () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    expectTypeOf(annotations.readOnlyHint).toEqualTypeOf<boolean | undefined>();
  });

  it("Middleware type matches @workkit/api pattern", () => {
    type TestMiddleware = Middleware<{ DB: unknown }>;
    expectTypeOf<TestMiddleware>().toBeFunction();
  });

  it("WorkerModule has fetch method", () => {
    type Module = WorkerModule<unknown>;
    expectTypeOf<Module["fetch"]>().toBeFunction();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/types.test.ts`
Expected: FAIL — cannot resolve `../src/types`

- [ ] **Step 3: Write the types module**

```ts
// src/types.ts
import type { MaybePromise } from "@workkit/types";

// ─── Standard Schema v1 (re-export from @workkit/api pattern) ────────

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaV1Issue>; readonly value?: undefined };

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  };
  readonly "~types"?: { readonly input: Input; readonly output: Output };
}

export type InferOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : never;
export type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;

// ─── Middleware ────────────────────────────────────────────────

export type MiddlewareNext = () => MaybePromise<Response>;
export type Middleware<TEnv = unknown> = (
  request: Request,
  env: TEnv,
  next: MiddlewareNext,
) => MaybePromise<Response>;

// ─── MCP Server Config ────────────────────────────────────────

export interface CorsConfig {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface MCPSessionConfig {
  storage: "durable-object";
  ttl?: number;
  maxSessions?: number;
}

export interface MCPAuthConfig {
  type: "bearer" | "api-key" | "custom";
  jwt?: Record<string, unknown>;
  headerName?: string;
  handler?: Middleware<any>;
  exclude?: string[];
}

export interface MCPServerConfig<TEnv = unknown> {
  name: string;
  version: string;
  description?: string;
  instructions?: string;
  basePath?: string;
  mcpPath?: string;
  cors?: CorsConfig | boolean;
  middleware?: Middleware<TEnv>[];
  session?: MCPSessionConfig;
  auth?: MCPAuthConfig;
  openapi?: {
    enabled?: boolean;
    swaggerUI?: boolean | { cdn?: boolean; bundle?: boolean };
    servers?: Array<{ url: string; description?: string }>;
  };
  health?: boolean;
  maxBodySize?: number;
  maxBatchSize?: number;
}

// ─── Tool Annotations (MCP 2025-06) ──────────────────────────

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// ─── Tool Config ──────────────────────────────────────────────

export interface ToolHandlerContext<
  TInput extends StandardSchemaV1,
  TEnv,
> {
  input: InferOutput<TInput>;
  env: TEnv;
  ctx: ExecutionContext;
  request: Request;
  log: Logger;
  reportProgress: (progress: number, total?: number) => Promise<void>;
  signal: AbortSignal;
  sessionId?: string;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export type ToolHandler<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1 | undefined,
  TEnv,
> = (
  ctx: ToolHandlerContext<TInput, TEnv>,
) => MaybePromise<
  TOutput extends StandardSchemaV1 ? InferOutput<TOutput> : unknown
>;

export interface ToolConfig<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  description: string;
  input: TInput;
  output?: TOutput;
  handler: ToolHandler<TInput, TOutput, TEnv>;
  tags?: string[];
  annotations?: ToolAnnotations;
  middleware?: Middleware<TEnv>[];
  timeout?: number;
  progress?: boolean;
  cancellable?: boolean;
}

// ─── Resource Config ──────────────────────────────────────────

export interface ResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: Uint8Array;
  }>;
}

export interface ResourceHandlerContext<TEnv> {
  uri: string;
  params: Record<string, string>;
  env: TEnv;
  ctx: ExecutionContext;
  log: Logger;
}

export type ResourceHandler<TEnv> = (
  ctx: ResourceHandlerContext<TEnv>,
) => MaybePromise<ResourceResult>;

export interface ResourceConfig<TEnv = unknown> {
  description?: string;
  mimeType?: string;
  handler: ResourceHandler<TEnv>;
  subscribe?: boolean;
}

// ─── Prompt Config ────────────────────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface EmbeddedResource {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type PromptMessageContent = TextContent | ImageContent | EmbeddedResource;

export interface PromptMessage {
  role: "user" | "assistant";
  content: PromptMessageContent;
}

export interface PromptResult {
  description?: string;
  messages: PromptMessage[];
}

export interface PromptHandlerContext<
  TArgs extends StandardSchemaV1 | undefined,
  TEnv,
> {
  args: TArgs extends StandardSchemaV1 ? InferOutput<TArgs> : undefined;
  env: TEnv;
  ctx: ExecutionContext;
  log: Logger;
}

export type PromptHandler<
  TArgs extends StandardSchemaV1 | undefined,
  TEnv,
> = (
  ctx: PromptHandlerContext<TArgs, TEnv>,
) => MaybePromise<PromptResult>;

export interface PromptConfig<
  TArgs extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  description?: string;
  args?: TArgs;
  handler: PromptHandler<TArgs, TEnv>;
}

// ─── Registry Types ───────────────────────────────────────────

export interface RegisteredTool<TEnv = unknown> {
  name: string;
  description: string;
  input: StandardSchemaV1;
  output?: StandardSchemaV1;
  handler: ToolHandler<any, any, TEnv>;
  tags: string[];
  annotations: ToolAnnotations;
  middleware: Middleware<TEnv>[];
  timeout: number;
  progress: boolean;
  cancellable: boolean;
}

export interface RegisteredResource<TEnv = unknown> {
  uri: string;
  description?: string;
  mimeType?: string;
  handler: ResourceHandler<TEnv>;
  subscribe: boolean;
  isTemplate: boolean;
}

export interface RegisteredPrompt<TEnv = unknown> {
  name: string;
  description?: string;
  args?: StandardSchemaV1;
  handler: PromptHandler<any, TEnv>;
}

// ─── Server Interface ─────────────────────────────────────────

export interface MCPServer<TEnv = unknown> {
  tool<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1 | undefined>(
    name: string,
    config: ToolConfig<TInput, TOutput, TEnv>,
  ): MCPServer<TEnv>;

  resource(uri: string, config: ResourceConfig<TEnv>): MCPServer<TEnv>;

  prompt<TArgs extends StandardSchemaV1 | undefined>(
    name: string,
    config: PromptConfig<TArgs, TEnv>,
  ): MCPServer<TEnv>;

  serve(): WorkerModule<TEnv>;

  mount(): {
    mcpHandler: (request: Request, env: TEnv) => Promise<Response>;
    restHandler: (request: Request, env: TEnv) => Promise<Response>;
    openapi: () => Record<string, unknown>;
  };

  toHono(): import("hono").Hono<{ Bindings: TEnv }>;

  readonly tools: ReadonlyMap<string, RegisteredTool<TEnv>>;
  readonly resources: ReadonlyMap<string, RegisteredResource<TEnv>>;
  readonly prompts: ReadonlyMap<string, RegisteredPrompt<TEnv>>;
}

// ─── Worker Module ────────────────────────────────────────────

export interface WorkerModule<TEnv> {
  fetch: (request: Request, env: TEnv, ctx: ExecutionContext) => Promise<Response>;
}

// ─── JSON-RPC Types ───────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ─── MCP Protocol Types ──────────────────────────────────────

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: { name: string; version: string };
  instructions?: string;
}

export interface MCPToolContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface MCPToolResult {
  content: MCPToolContent[];
  isError?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/types.ts packages/mcp/tests/types.test.ts
git commit -m "feat(mcp): add type definitions"
```

---

### Task 3: Tool/Resource/Prompt Registries

**Files:**
- Create: `packages/mcp/src/registry.ts`
- Test: `packages/mcp/tests/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/registry.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createToolRegistry, createResourceRegistry, createPromptRegistry } from "../src/registry";

describe("ToolRegistry", () => {
  it("registers a tool and retrieves it", () => {
    const registry = createToolRegistry();
    registry.register("search", {
      description: "Search docs",
      input: z.object({ query: z.string() }),
      handler: async ({ input }) => ({ results: [] }),
    });

    expect(registry.get("search")).toBeDefined();
    expect(registry.get("search")!.name).toBe("search");
    expect(registry.get("search")!.description).toBe("Search docs");
    expect(registry.size).toBe(1);
  });

  it("throws on duplicate tool name", () => {
    const registry = createToolRegistry();
    registry.register("search", {
      description: "Search",
      input: z.object({ query: z.string() }),
      handler: async () => ({}),
    });

    expect(() =>
      registry.register("search", {
        description: "Search again",
        input: z.object({ query: z.string() }),
        handler: async () => ({}),
      }),
    ).toThrow('Tool "search" already registered');
  });

  it("applies default values for optional fields", () => {
    const registry = createToolRegistry();
    registry.register("test", {
      description: "Test",
      input: z.object({}),
      handler: async () => ({}),
    });

    const tool = registry.get("test")!;
    expect(tool.tags).toEqual([]);
    expect(tool.annotations).toEqual({});
    expect(tool.middleware).toEqual([]);
    expect(tool.timeout).toBe(25000);
    expect(tool.progress).toBe(false);
    expect(tool.cancellable).toBe(false);
  });

  it("lists all registered tools", () => {
    const registry = createToolRegistry();
    registry.register("a", { description: "A", input: z.object({}), handler: async () => ({}) });
    registry.register("b", { description: "B", input: z.object({}), handler: async () => ({}) });

    const all = registry.all();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("freeze prevents further registration", () => {
    const registry = createToolRegistry();
    registry.register("a", { description: "A", input: z.object({}), handler: async () => ({}) });
    registry.freeze();

    expect(() =>
      registry.register("b", { description: "B", input: z.object({}), handler: async () => ({}) }),
    ).toThrow("Registry is frozen");
  });
});

describe("ResourceRegistry", () => {
  it("registers a static resource", () => {
    const registry = createResourceRegistry();
    registry.register("config://app/settings", {
      description: "App settings",
      mimeType: "application/json",
      handler: async () => ({ contents: [{ uri: "config://app/settings", text: "{}" }] }),
    });

    expect(registry.get("config://app/settings")).toBeDefined();
    expect(registry.get("config://app/settings")!.isTemplate).toBe(false);
  });

  it("detects URI templates", () => {
    const registry = createResourceRegistry();
    registry.register("file://docs/{path}", {
      handler: async () => ({ contents: [] }),
    });

    const resource = registry.get("file://docs/{path}")!;
    expect(resource.isTemplate).toBe(true);
  });

  it("matches URI against templates", () => {
    const registry = createResourceRegistry();
    registry.register("db://users/{id}", {
      handler: async () => ({ contents: [] }),
    });

    const match = registry.match("db://users/abc-123");
    expect(match).toBeDefined();
    expect(match!.params).toEqual({ id: "abc-123" });
  });

  it("matches exact URIs before templates", () => {
    const registry = createResourceRegistry();
    registry.register("db://users/admin", {
      description: "Admin user",
      handler: async () => ({ contents: [{ uri: "db://users/admin", text: "admin" }] }),
    });
    registry.register("db://users/{id}", {
      handler: async () => ({ contents: [] }),
    });

    const match = registry.match("db://users/admin");
    expect(match!.resource.description).toBe("Admin user");
  });
});

describe("PromptRegistry", () => {
  it("registers and retrieves a prompt", () => {
    const registry = createPromptRegistry();
    registry.register("summarize", {
      description: "Summarize a doc",
      args: z.object({ docId: z.string() }),
      handler: async ({ args }) => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: `Summarize ${args.docId}` } }],
      }),
    });

    expect(registry.get("summarize")).toBeDefined();
    expect(registry.get("summarize")!.description).toBe("Summarize a doc");
  });

  it("throws on duplicate prompt name", () => {
    const registry = createPromptRegistry();
    registry.register("test", {
      handler: async () => ({ messages: [] }),
    });
    expect(() =>
      registry.register("test", { handler: async () => ({ messages: [] }) }),
    ).toThrow('Prompt "test" already registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/registry.test.ts`
Expected: FAIL — cannot resolve `../src/registry`

- [ ] **Step 3: Write the registry module**

Create `packages/mcp/src/registry.ts`:

Implement three factory functions:
- `createToolRegistry()` — stores `RegisteredTool` entries in a `Map<string, RegisteredTool>`, throws on duplicate names, applies defaults (timeout: 25000, tags: [], annotations: {}, middleware: [], progress: false, cancellable: false), supports `freeze()` that prevents further registration, `all()` returns ordered array, `size` getter
- `createResourceRegistry()` — stores `RegisteredResource`, detects URI templates by `{param}` pattern, `match(uri)` resolves templates and extracts params (exact match wins over template), `templates()` returns template entries only
- `createPromptRegistry()` — stores `RegisteredPrompt`, throws on duplicates, simple get/all/size

Each registry should be a plain object with methods (not a class) following the @workkit pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/registry.test.ts`
Expected: PASS — all assertions green

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/registry.ts packages/mcp/tests/registry.test.ts
git commit -m "feat(mcp): add tool/resource/prompt registries"
```

---

### Task 4: Validation Bridge

**Files:**
- Create: `packages/mcp/src/validation.ts`
- Test: `packages/mcp/tests/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validation.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateInput, schemaToJsonSchema } from "../src/validation";

describe("validateInput", () => {
  it("validates valid input against schema", async () => {
    const schema = z.object({ query: z.string(), limit: z.number().default(10) });
    const result = await validateInput(schema, { query: "test" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ query: "test", limit: 10 });
    }
  });

  it("returns error for invalid input", async () => {
    const schema = z.object({ query: z.string() });
    const result = await validateInput(schema, { query: 123 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns error for missing required fields", async () => {
    const schema = z.object({ query: z.string() });
    const result = await validateInput(schema, {});

    expect(result.ok).toBe(false);
  });
});

describe("schemaToJsonSchema", () => {
  it("converts Zod object to JSON Schema", () => {
    const schema = z.object({
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(100).default(10),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toHaveProperty("query");
    expect(jsonSchema.properties).toHaveProperty("limit");
    expect(jsonSchema.required).toContain("query");
  });

  it("handles nested objects", () => {
    const schema = z.object({
      filter: z.object({
        status: z.enum(["active", "archived"]),
      }),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.properties.filter.type).toBe("object");
  });

  it("handles arrays", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.properties.tags.type).toBe("array");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/validation.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the validation module**

Create `packages/mcp/src/validation.ts`:

- `validateInput(schema, input)` — Uses Standard Schema v1 `~standard.validate()`. Returns `{ ok: true, value }` or `{ ok: false, error: { issues } }`. Same result pattern as @workkit/api's `validate()`.
- `schemaToJsonSchema(schema)` — Extracts JSON Schema from a Standard Schema. For Zod schemas, uses `schema._def` inspection to build a JSON Schema object (type, properties, required, items, enum, description, default). Handles: string, number, boolean, object, array, enum, literal, optional, default, nullable. Falls back to `{}` for unknown schema types. This is needed for MCP `tools/list` inputSchema and OpenAPI spec generation.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/validation.ts packages/mcp/tests/validation.test.ts
git commit -m "feat(mcp): add Standard Schema validation bridge"
```

---

### Task 5: MCP Error Mapping

**Files:**
- Create: `packages/mcp/src/errors.ts`
- Test: `packages/mcp/tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  toMCPToolError,
  toJsonRpcError,
  toRestError,
  MCPProtocolError,
} from "../src/errors";
import { ValidationError, UnauthorizedError, TimeoutError } from "@workkit/errors";

describe("toMCPToolError", () => {
  it("wraps WorkkitError as isError result", () => {
    const error = new ValidationError("bad input", [{ message: "Required", path: ["query"] }]);
    const result = toMCPToolError(error);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Validation error");
  });

  it("wraps unknown error with generic message in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const error = new Error("secret internal details");
    const result = toMCPToolError(error);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("secret internal details");
    expect(result.content[0].text).toContain("Internal error");

    process.env.NODE_ENV = original;
  });

  it("includes details in development mode", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const error = new Error("debug details");
    const result = toMCPToolError(error);

    expect(result.content[0].text).toContain("debug details");

    process.env.NODE_ENV = original;
  });
});

describe("toJsonRpcError", () => {
  it("maps parse error to -32700", () => {
    const error = MCPProtocolError.parseError("Invalid JSON");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32700);
    expect(rpc.message).toBe("Parse error");
  });

  it("maps method not found to -32601", () => {
    const error = MCPProtocolError.methodNotFound("unknown/method");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32601);
  });

  it("maps invalid params to -32602", () => {
    const error = MCPProtocolError.invalidParams("Missing required field");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32602);
  });
});

describe("toRestError", () => {
  it("maps ValidationError to 400 response", () => {
    const error = new ValidationError("bad", []);
    const response = toRestError(error);

    expect(response.status).toBe(400);
  });

  it("maps UnauthorizedError to 401 response", () => {
    const error = new UnauthorizedError("no token");
    const response = toRestError(error);

    expect(response.status).toBe(401);
  });

  it("maps TimeoutError to 504 response", () => {
    const error = new TimeoutError("too slow");
    const response = toRestError(error);

    expect(response.status).toBe(504);
  });

  it("maps unknown error to 500 response", () => {
    const error = new Error("oops");
    const response = toRestError(error);

    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/errors.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the errors module**

Create `packages/mcp/src/errors.ts`:

- `MCPProtocolError` — class with static factories: `parseError()`, `methodNotFound()`, `invalidParams()`, `invalidRequest()`, `internalError()`. Each stores the JSON-RPC error code.
- `toMCPToolError(error)` — converts any error into an `MCPToolResult` with `isError: true`. WorkkitError subclasses preserve their message. Unknown errors get "Internal error" in production, full message in development.
- `toJsonRpcError(error)` — converts MCPProtocolError to `JsonRpcError` with correct code (-32700, -32600, -32601, -32602, -32603).
- `toRestError(error)` — converts any error to a `Response` using `@workkit/errors` `errorToResponse()`. Special case: TimeoutError → 504.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/errors.ts packages/mcp/tests/errors.test.ts
git commit -m "feat(mcp): add MCP error mapping"
```

---

### Task 6: Timeout Wrapper

**Files:**
- Create: `packages/mcp/src/timeout.ts`
- Test: `packages/mcp/tests/timeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/timeout.test.ts
import { describe, it, expect } from "vitest";
import { executeWithTimeout } from "../src/timeout";

describe("executeWithTimeout", () => {
  it("returns handler result when within timeout", async () => {
    const result = await executeWithTimeout(
      async () => "ok",
      1000,
      new AbortController().signal,
    );
    expect(result).toBe("ok");
  });

  it("throws TimeoutError when handler exceeds timeout", async () => {
    await expect(
      executeWithTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
        50,
        new AbortController().signal,
      ),
    ).rejects.toThrow("exceeded");
  });

  it("aborts when signal fires", async () => {
    const controller = new AbortController();

    const promise = executeWithTimeout(
      () => new Promise((resolve) => setTimeout(resolve, 5000)),
      10000,
      controller.signal,
    );

    controller.abort(new Error("cancelled"));

    await expect(promise).rejects.toThrow("cancelled");
  });

  it("clears timeout on successful completion", async () => {
    // This test ensures no dangling timers
    const result = await executeWithTimeout(
      async () => 42,
      5000,
      new AbortController().signal,
    );
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/timeout.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the timeout module**

Create `packages/mcp/src/timeout.ts`:

```ts
import { TimeoutError } from "@workkit/errors";

export async function executeWithTimeout<T>(
  handler: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Aborted");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });

    handler().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/timeout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/timeout.ts packages/mcp/tests/timeout.test.ts
git commit -m "feat(mcp): add tool execution timeout wrapper"
```

---

### Task 7: MCP Protocol Dispatcher

**Files:**
- Create: `packages/mcp/src/protocol.ts`
- Test: `packages/mcp/tests/protocol.test.ts`

This is the core of the MCP server — dispatches JSON-RPC methods to the correct handlers.

- [ ] **Step 1: Write the failing test**

```ts
// tests/protocol.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createProtocolHandler } from "../src/protocol";
import { createToolRegistry, createResourceRegistry, createPromptRegistry } from "../src/registry";

function setupHandler() {
  const tools = createToolRegistry();
  const resources = createResourceRegistry();
  const prompts = createPromptRegistry();

  tools.register("search", {
    description: "Search docs",
    input: z.object({ query: z.string() }),
    handler: async ({ input }) => ({ results: [`found: ${input.query}`] }),
  });

  resources.register("config://settings", {
    description: "Settings",
    handler: async () => ({
      contents: [{ uri: "config://settings", mimeType: "application/json", text: '{"theme":"dark"}' }],
    }),
  });

  prompts.register("greet", {
    description: "Greet user",
    args: z.object({ name: z.string() }),
    handler: async ({ args }) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `Hello ${args.name}` } }],
    }),
  });

  tools.freeze();
  resources.freeze();
  prompts.freeze();

  return createProtocolHandler({
    serverName: "test-server",
    serverVersion: "1.0.0",
    tools,
    resources,
    prompts,
  });
}

describe("MCP Protocol Handler", () => {
  it("handles initialize", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    expect(result.id).toBe(1);
    expect(result.result).toBeDefined();
    expect(result.result.protocolVersion).toBe("2025-06-18");
    expect(result.result.serverInfo.name).toBe("test-server");
    expect(result.result.capabilities.tools).toBeDefined();
    expect(result.result.capabilities.resources).toBeDefined();
    expect(result.result.capabilities.prompts).toBeDefined();
  });

  it("handles ping", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });

    expect(result.id).toBe(2);
    expect(result.result).toEqual({});
  });

  it("handles tools/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    expect(result.result.tools).toHaveLength(1);
    expect(result.result.tools[0].name).toBe("search");
    expect(result.result.tools[0].inputSchema).toBeDefined();
  });

  it("handles tools/call with valid input", async () => {
    const handler = setupHandler();
    const env = {};
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "search", arguments: { query: "test" } },
      },
      { env, ctx },
    );

    expect(result.result.content).toHaveLength(1);
    expect(result.result.content[0].type).toBe("text");
    expect(JSON.parse(result.result.content[0].text)).toEqual({ results: ["found: test"] });
    expect(result.result.isError).toBeUndefined();
  });

  it("handles tools/call with invalid input", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "search", arguments: { query: 123 } },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.isError).toBe(true);
  });

  it("handles tools/call for unknown tool", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "nonexistent", arguments: {} },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  it("handles resources/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/list",
    });

    expect(result.result.resources).toHaveLength(1);
    expect(result.result.resources[0].uri).toBe("config://settings");
  });

  it("handles resources/read", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "resources/read",
        params: { uri: "config://settings" },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.contents).toHaveLength(1);
    expect(result.result.contents[0].text).toBe('{"theme":"dark"}');
  });

  it("handles prompts/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 9,
      method: "prompts/list",
    });

    expect(result.result.prompts).toHaveLength(1);
    expect(result.result.prompts[0].name).toBe("greet");
  });

  it("handles prompts/get", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "prompts/get",
        params: { name: "greet", arguments: { name: "Alice" } },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.messages).toHaveLength(1);
    expect(result.result.messages[0].content.text).toBe("Hello Alice");
  });

  it("handles resources/templates/list", async () => {
    const tools = createToolRegistry();
    const resources = createResourceRegistry();
    const prompts = createPromptRegistry();

    resources.register("db://users/{id}", {
      description: "User by ID",
      handler: async () => ({ contents: [] }),
    });
    resources.register("config://settings", {
      description: "Settings",
      handler: async () => ({ contents: [{ uri: "config://settings", text: "{}" }] }),
    });

    tools.freeze();
    resources.freeze();
    prompts.freeze();

    const handler = createProtocolHandler({
      serverName: "test",
      serverVersion: "1.0.0",
      tools,
      resources,
      prompts,
    });

    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 12,
      method: "resources/templates/list",
    });

    expect(result.result.resourceTemplates).toHaveLength(1);
    expect(result.result.resourceTemplates[0].uriTemplate).toBe("db://users/{id}");
  });

  it("returns method not found for unknown methods", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 11,
      method: "unknown/method",
    });

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
  });

  it("ignores notifications (no id) without error", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/protocol.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the protocol handler**

Create `packages/mcp/src/protocol.ts`:

Implement `createProtocolHandler(config)` that:
- Takes `{ serverName, serverVersion, instructions?, tools, resources, prompts }`
- Returns `{ dispatch(message, context?) }` where context is `{ env, ctx, request? }`
- `dispatch()` parses the JSON-RPC method and routes to the correct handler:
  - `initialize` → returns capabilities + server info
  - `initialized` (notification) → no-op, return null
  - `ping` → return `{}`
  - `tools/list` → iterate tool registry, convert input schema to JSON Schema via `schemaToJsonSchema()`
  - `tools/call` → validate params.name exists, validate input against schema, run handler with timeout, serialize output as `{ content: [{ type: "text", text: JSON.stringify(output) }] }`. On validation error → `isError: true`. On handler error → `toMCPToolError()`.
  - `resources/list` → list all resources with URI and description
  - `resources/read` → match URI against registry, run handler
  - `resources/templates/list` → list only template resources
  - `prompts/list` → list all prompts with name, description, argument schema
  - `prompts/get` → validate args against schema, run handler
  - Notifications (no `id`) → return null
  - Unknown method → JSON-RPC error -32601

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/protocol.ts packages/mcp/tests/protocol.test.ts
git commit -m "feat(mcp): add MCP protocol dispatcher"
```

---

### Task 8: Streamable HTTP Transport

**Files:**
- Create: `packages/mcp/src/transport.ts`
- Test: `packages/mcp/tests/transport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/transport.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTransportHandler } from "../src/transport";
import { createProtocolHandler } from "../src/protocol";
import { createToolRegistry, createResourceRegistry, createPromptRegistry } from "../src/registry";

function setupTransport() {
  const tools = createToolRegistry();
  const resources = createResourceRegistry();
  const prompts = createPromptRegistry();

  tools.register("echo", {
    description: "Echo input",
    input: z.object({ msg: z.string() }),
    handler: async ({ input }) => ({ echo: input.msg }),
  });

  tools.freeze();
  resources.freeze();
  prompts.freeze();

  const protocol = createProtocolHandler({
    serverName: "test",
    serverVersion: "1.0.0",
    tools,
    resources,
    prompts,
  });

  return createTransportHandler({ protocol, mcpPath: "/mcp" });
}

function jsonRpcRequest(method: string, params?: Record<string, unknown>, id: number = 1) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

describe("Streamable HTTP Transport", () => {
  it("handles POST /mcp with JSON-RPC initialize", async () => {
    const transport = setupTransport();
    const env = {};
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

    const response = await transport.handleRequest(
      jsonRpcRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.serverInfo.name).toBe("test");
  });

  it("handles POST /mcp with tools/call", async () => {
    const transport = setupTransport();
    const env = {};
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

    const response = await transport.handleRequest(
      jsonRpcRequest("tools/call", { name: "echo", arguments: { msg: "hello" } }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.content[0].text).toBe('{"echo":"hello"}');
  });

  it("returns 400 for invalid JSON body", async () => {
    const transport = setupTransport();
    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      {},
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for missing jsonrpc field", async () => {
    const transport = setupTransport();
    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "ping" }),
      }),
      {},
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );

    expect(response.status).toBe(400);
  });

  it("handles JSON-RPC batch requests", async () => {
    const transport = setupTransport();
    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]),
      }),
      {},
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it("rejects batch exceeding maxBatchSize", async () => {
    const tools = createToolRegistry();
    tools.register("echo", {
      description: "Echo",
      input: z.object({ msg: z.string() }),
      handler: async ({ input }) => ({ echo: input.msg }),
    });
    tools.freeze();
    const resources = createResourceRegistry();
    resources.freeze();
    const prompts = createPromptRegistry();
    prompts.freeze();

    const protocol = createProtocolHandler({
      serverName: "test",
      serverVersion: "1.0.0",
      tools,
      resources,
      prompts,
    });

    const transport = createTransportHandler({
      protocol,
      mcpPath: "/mcp",
      maxBatchSize: 2,
    });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "ping" },
          { jsonrpc: "2.0", id: 3, method: "ping" },
        ]),
      }),
      {},
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(-32600);
  });

  it("returns 405 for unsupported methods", async () => {
    const transport = setupTransport();
    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", { method: "PUT" }),
      {},
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );

    expect(response.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/transport.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the transport module**

Create `packages/mcp/src/transport.ts`:

Implement `createTransportHandler(config)`:
- `config: { protocol, mcpPath, maxBatchSize? }`
- Returns `{ handleRequest(request, env, ctx) }`
- POST /mcp: parse JSON body → if array, handle as batch (up to maxBatchSize, default 10, use `Promise.allSettled`), if object, handle as single message → dispatch to protocol handler → wrap result as JSON-RPC response
- GET /mcp: return 405 (SSE transport not implemented in v1, can be added later)
- DELETE /mcp: return 405 (session termination not implemented in v1)
- Validate Content-Type is application/json
- Handle parse errors → JSON-RPC error -32700
- Handle missing jsonrpc:"2.0" → JSON-RPC error -32600

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/transport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/transport.ts packages/mcp/tests/transport.test.ts
git commit -m "feat(mcp): add Streamable HTTP transport"
```

---

### Task 9: REST Endpoint Generation

**Files:**
- Create: `packages/mcp/src/rest.ts`
- Test: `packages/mcp/tests/rest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/rest.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createRestHandler } from "../src/rest";
import { createToolRegistry } from "../src/registry";

function setupRest(opts?: { basePath?: string; middleware?: any[] }) {
  const tools = createToolRegistry();

  tools.register("search", {
    description: "Search docs",
    input: z.object({ query: z.string(), limit: z.number().default(10) }),
    handler: async ({ input }) => ({
      results: [`found: ${input.query}`],
      total: 1,
    }),
  });

  tools.register("failing-tool", {
    description: "Always fails",
    input: z.object({}),
    handler: async () => {
      throw new Error("tool broke");
    },
  });

  tools.freeze();

  return createRestHandler({
    tools,
    basePath: opts?.basePath ?? "/api",
    middleware: opts?.middleware ?? [],
  });
}

describe("REST Handler", () => {
  const env = {};
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

  it("POST /api/tools/search returns 200 with result", async () => {
    const rest = setupRest();
    const response = await rest.handleRequest(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ results: ["found: test"], total: 1 });
  });

  it("applies default values from schema", async () => {
    const rest = setupRest();
    const response = await rest.handleRequest(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid input", async () => {
    const rest = setupRest();
    const response = await rest.handleRequest(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: 123 }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for unknown tool", async () => {
    const rest = setupRest();
    const response = await rest.handleRequest(
      new Request("http://localhost/api/tools/nonexistent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(404);
  });

  it("returns 500 for handler errors", async () => {
    const rest = setupRest();
    const response = await rest.handleRequest(
      new Request("http://localhost/api/tools/failing-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(500);
  });

  it("respects custom basePath", async () => {
    const rest = setupRest({ basePath: "/v1" });
    const response = await rest.handleRequest(
      new Request("http://localhost/v1/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
  });

  it("runs server-level middleware", async () => {
    const called: string[] = [];
    const middleware = async (req: Request, env: any, next: () => any) => {
      called.push("middleware");
      return next();
    };

    const rest = setupRest({ middleware: [middleware] });
    await rest.handleRequest(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
      env,
      ctx,
    );

    expect(called).toEqual(["middleware"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/rest.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the REST handler**

Create `packages/mcp/src/rest.ts`:

Implement `createRestHandler(config)`:
- `config: { tools, basePath, middleware }`
- Returns `{ handleRequest(request, env, ctx) }`
- Extracts tool name from URL: `{basePath}/tools/{toolName}`
- Looks up tool in registry → 404 if not found
- Runs server-level middleware chain → tool-level middleware chain → handler
- Parses JSON body → validates against tool input schema
- On success: `200 { result: <handler output> }`
- On validation error: `400 { error: { code: "VALIDATION_ERROR", message, issues } }`
- On handler error: uses `toRestError()` from errors module
- On missing/invalid Content-Type: `415`
- Returns null if URL doesn't match `{basePath}/tools/*` pattern (not our route)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/rest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/rest.ts packages/mcp/tests/rest.test.ts
git commit -m "feat(mcp): add REST endpoint generation"
```

---

### Task 10: OpenAPI Spec Generation

**Files:**
- Create: `packages/mcp/src/openapi.ts`
- Test: `packages/mcp/tests/openapi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/openapi.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateOpenAPISpec } from "../src/openapi";
import { createToolRegistry } from "../src/registry";

describe("generateOpenAPISpec", () => {
  it("generates valid OpenAPI 3.1 spec", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search documents",
      input: z.object({ query: z.string() }),
      output: z.object({ results: z.array(z.string()) }),
      tags: ["search"],
      handler: async () => ({ results: [] }),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test-api",
      serverVersion: "1.0.0",
      description: "Test API",
      basePath: "/api",
      tools,
    });

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("test-api");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("generates path for each tool", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({ query: z.string() }),
      handler: async () => ({}),
    });
    tools.register("create", {
      description: "Create item",
      input: z.object({ name: z.string() }),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    expect(spec.paths["/api/tools/search"]).toBeDefined();
    expect(spec.paths["/api/tools/search"].post).toBeDefined();
    expect(spec.paths["/api/tools/create"]).toBeDefined();
  });

  it("includes request body schema from tool input", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({
        query: z.string(),
        limit: z.number().default(10),
      }),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const requestBody = spec.paths["/api/tools/search"].post.requestBody;
    expect(requestBody.required).toBe(true);
    const schema = requestBody.content["application/json"].schema;
    expect(schema.properties.query).toBeDefined();
  });

  it("includes response schema when output is defined", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({ query: z.string() }),
      output: z.object({ results: z.array(z.string()), total: z.number() }),
      handler: async () => ({ results: [], total: 0 }),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const responses = spec.paths["/api/tools/search"].post.responses;
    expect(responses["200"]).toBeDefined();
    const schema = responses["200"].content["application/json"].schema;
    expect(schema.properties.result).toBeDefined();
  });

  it("includes error response references", () => {
    const tools = createToolRegistry();
    tools.register("test", {
      description: "Test",
      input: z.object({}),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const responses = spec.paths["/api/tools/test"].post.responses;
    expect(responses["400"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
  });

  it("includes server URLs when provided", () => {
    const tools = createToolRegistry();
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
      servers: [{ url: "https://api.example.com", description: "Production" }],
    });

    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0].url).toBe("https://api.example.com");
  });

  it("uses tool tags for grouping", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({}),
      tags: ["search", "read"],
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    expect(spec.paths["/api/tools/search"].post.tags).toEqual(["search", "read"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/openapi.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the OpenAPI generator**

Create `packages/mcp/src/openapi.ts`:

Implement `generateOpenAPISpec(config)`:
- Takes `{ serverName, serverVersion, description?, basePath, tools, servers? }`
- Returns a complete OpenAPI 3.1.0 spec object
- For each tool: generates `POST {basePath}/tools/{toolName}` with:
  - `operationId: tool_{name}`
  - `summary: tool.description`
  - `tags: tool.tags` (default: `["tools"]`)
  - `requestBody` with input schema converted via `schemaToJsonSchema()`
  - `responses.200` with `{ result: outputSchema }` if output defined, else `{ result: {} }`
  - Error responses: 400 (ValidationError), 401 (Unauthorized), 429 (RateLimited), 500 (InternalError) as `$ref` to shared components
- Includes shared error response components in `components.responses`
- Includes security schemes if auth is configured

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/openapi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/openapi.ts packages/mcp/tests/openapi.test.ts
git commit -m "feat(mcp): add OpenAPI 3.1 spec generation"
```

---

### Task 11: Server Builder (createMCPServer)

**Files:**
- Create: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/server.test.ts`

This ties everything together — the main entry point.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createMCPServer } from "../src/server";

describe("createMCPServer", () => {
  it("creates a server with minimal config", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" });
    expect(server).toBeDefined();
    expect(server.tools.size).toBe(0);
  });

  it("registers tools via builder pattern", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" })
      .tool("a", {
        description: "Tool A",
        input: z.object({ x: z.string() }),
        handler: async () => ({}),
      })
      .tool("b", {
        description: "Tool B",
        input: z.object({ y: z.number() }),
        handler: async () => ({}),
      });

    expect(server.tools.size).toBe(2);
  });

  it("registers resources", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" })
      .resource("config://settings", {
        handler: async () => ({ contents: [{ uri: "config://settings", text: "{}" }] }),
      });

    expect(server.resources.size).toBe(1);
  });

  it("registers prompts", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" })
      .prompt("greet", {
        handler: async () => ({
          messages: [{ role: "user" as const, content: { type: "text" as const, text: "Hi" } }],
        }),
      });

    expect(server.prompts.size).toBe(1);
  });

  it("serve() returns a WorkerModule with fetch", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" })
      .tool("ping", {
        description: "Ping",
        input: z.object({}),
        handler: async () => ({ pong: true }),
      });

    const module = server.serve();
    expect(module.fetch).toBeDefined();
    expect(typeof module.fetch).toBe("function");
  });

  it("serve() freezes registries — no more registrations", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" });
    server.serve();

    expect(() =>
      server.tool("late", {
        description: "Late",
        input: z.object({}),
        handler: async () => ({}),
      }),
    ).toThrow();
  });

  it("warns when no tools registered", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    const server = createMCPServer({ name: "test", version: "1.0.0" });
    server.serve();

    console.warn = originalWarn;
    expect(warnings.some((w) => w.includes("no tools"))).toBe(true);
  });

  it("mount() returns handler functions without freezing immediately", () => {
    const server = createMCPServer({ name: "test", version: "1.0.0" })
      .tool("test", {
        description: "Test",
        input: z.object({}),
        handler: async () => ({}),
      });

    const mounted = server.mount();
    expect(mounted.mcpHandler).toBeDefined();
    expect(mounted.restHandler).toBeDefined();
    expect(mounted.openapi).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mcp && bun run test -- tests/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the server builder**

Create `packages/mcp/src/server.ts`:

Implement `createMCPServer(config)`:
- Creates tool/resource/prompt registries
- Returns an object implementing `MCPServer<TEnv>`:
  - `.tool()` → registers in tool registry, returns `this` for chaining
  - `.resource()` → registers in resource registry, returns `this`
  - `.prompt()` → registers in prompt registry, returns `this`
  - `.serve()` → freezes all registries, warns if no tools, creates protocol handler + transport handler + REST handler, builds a Hono app that routes:
    - `POST {mcpPath}` → transport handler
    - `GET {mcpPath}` → 405 (future SSE)
    - `{basePath}/tools/*` → REST handler
    - `GET /openapi.json` → cached OpenAPI spec (if enabled)
    - `GET /health` → `{ status: "ok" }` (if enabled)
  - `.mount()` → returns individual handlers without building the full Hono app
  - `.tools`, `.resources`, `.prompts` → readonly Map views of registries

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/mcp && bun run test -- tests/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/tests/server.test.ts
git commit -m "feat(mcp): add createMCPServer builder"
```

---

### Task 12: Integration Tests

**Files:**
- Create: `packages/mcp/tests/integration.test.ts`
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Write the integration test**

```ts
// tests/integration.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createMCPServer } from "../src/server";

describe("Integration: Full MCP Server", () => {
  function createTestServer() {
    return createMCPServer({
      name: "test-tools",
      version: "1.0.0",
      description: "Integration test server",
    })
      .tool("search", {
        description: "Search documents",
        input: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(10),
        }),
        output: z.object({
          results: z.array(z.object({ title: z.string(), score: z.number() })),
          total: z.number(),
        }),
        tags: ["search"],
        annotations: { readOnlyHint: true },
        handler: async ({ input }) => ({
          results: [{ title: `Result for "${input.query}"`, score: 0.95 }],
          total: 1,
        }),
      })
      .resource("config://settings", {
        description: "App settings",
        mimeType: "application/json",
        handler: async () => ({
          contents: [{ uri: "config://settings", mimeType: "application/json", text: '{"theme":"dark"}' }],
        }),
      })
      .prompt("summarize", {
        description: "Summarize content",
        args: z.object({ style: z.enum(["brief", "detailed"]).default("brief") }),
        handler: async ({ args }) => ({
          messages: [{
            role: "user" as const,
            content: { type: "text" as const, text: `Summarize in ${args.style} style` },
          }],
        }),
      })
      .serve();
  }

  const env = {};
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

  // ─── MCP Protocol Path ──────────────────────────────────────────

  it("MCP: initialize → tools/list → tools/call flow", async () => {
    const server = createTestServer();

    // Step 1: Initialize
    const initRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        }),
      }),
      env, ctx,
    );
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json();
    expect(initBody.result.capabilities.tools).toBeDefined();

    // Step 2: List tools
    const listRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
      env, ctx,
    );
    const listBody = await listRes.json();
    expect(listBody.result.tools).toHaveLength(1);
    expect(listBody.result.tools[0].name).toBe("search");
    expect(listBody.result.tools[0].inputSchema).toBeDefined();

    // Step 3: Call tool
    const callRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 3, method: "tools/call",
          params: { name: "search", arguments: { query: "cloudflare workers" } },
        }),
      }),
      env, ctx,
    );
    const callBody = await callRes.json();
    expect(callBody.result.isError).toBeUndefined();
    const toolResult = JSON.parse(callBody.result.content[0].text);
    expect(toolResult.results[0].title).toContain("cloudflare workers");
  });

  it("MCP: resources/list → resources/read", async () => {
    const server = createTestServer();

    const listRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
      }),
      env, ctx,
    );
    const listBody = await listRes.json();
    expect(listBody.result.resources).toHaveLength(1);

    const readRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "resources/read",
          params: { uri: "config://settings" },
        }),
      }),
      env, ctx,
    );
    const readBody = await readRes.json();
    expect(readBody.result.contents[0].text).toBe('{"theme":"dark"}');
  });

  it("MCP: prompts/list → prompts/get", async () => {
    const server = createTestServer();

    const listRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list" }),
      }),
      env, ctx,
    );
    const listBody = await listRes.json();
    expect(listBody.result.prompts).toHaveLength(1);

    const getRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "prompts/get",
          params: { name: "summarize", arguments: { style: "detailed" } },
        }),
      }),
      env, ctx,
    );
    const getBody = await getRes.json();
    expect(getBody.result.messages[0].content.text).toContain("detailed");
  });

  // ─── REST Path ──────────────────────────────────────────────────

  it("REST: POST /api/tools/search returns result", async () => {
    const server = createTestServer();

    const res = await server.fetch(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
      env, ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.results).toHaveLength(1);
    expect(body.result.total).toBe(1);
  });

  it("REST: POST /api/tools/search with invalid input returns 400", async () => {
    const server = createTestServer();

    const res = await server.fetch(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "" }),
      }),
      env, ctx,
    );

    expect(res.status).toBe(400);
  });

  // ─── Meta Endpoints ─────────────────────────────────────────────

  it("GET /openapi.json returns spec", async () => {
    const server = createTestServer();

    const res = await server.fetch(
      new Request("http://localhost/openapi.json"),
      env, ctx,
    );

    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/tools/search"]).toBeDefined();
  });

  it("GET /health returns ok", async () => {
    const server = createTestServer();

    const res = await server.fetch(
      new Request("http://localhost/health"),
      env, ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  // ─── Same Handler, Two Paths ────────────────────────────────────

  it("MCP and REST paths return consistent results", async () => {
    const server = createTestServer();

    // MCP path
    const mcpRes = await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "search", arguments: { query: "consistency" } },
        }),
      }),
      env, ctx,
    );
    const mcpBody = await mcpRes.json();
    const mcpResult = JSON.parse(mcpBody.result.content[0].text);

    // REST path
    const restRes = await server.fetch(
      new Request("http://localhost/api/tools/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "consistency" }),
      }),
      env, ctx,
    );
    const restBody = await restRes.json();

    // Same handler, same result
    expect(mcpResult).toEqual(restBody.result);
  });
});
```

- [ ] **Step 2: Update src/index.ts with all exports**

```ts
// src/index.ts
// Server
export { createMCPServer } from "./server";

// Types
export type {
  // Server config
  MCPServerConfig,
  MCPSessionConfig,
  MCPAuthConfig,
  CorsConfig,
  // Tool
  ToolConfig,
  ToolHandler,
  ToolHandlerContext,
  ToolAnnotations,
  // Resource
  ResourceConfig,
  ResourceHandler,
  ResourceHandlerContext,
  ResourceResult,
  // Prompt
  PromptConfig,
  PromptHandler,
  PromptHandlerContext,
  PromptResult,
  PromptMessage,
  PromptMessageContent,
  TextContent,
  ImageContent,
  EmbeddedResource,
  // Registry
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  // Server interface
  MCPServer,
  WorkerModule,
  // Standard Schema
  StandardSchemaV1,
  InferOutput,
  InferInput,
  // Middleware
  Middleware,
  MiddlewareNext,
  // JSON-RPC
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  // MCP Protocol
  ServerCapabilities,
  InitializeResult,
  MCPToolResult,
} from "./types";

// Utilities (for advanced users)
export { generateOpenAPISpec } from "./openapi";
export { schemaToJsonSchema, validateInput } from "./validation";
```

- [ ] **Step 3: Run integration tests**

Run: `cd packages/mcp && bun run test -- tests/integration.test.ts`
Expected: PASS — all integration scenarios green

- [ ] **Step 4: Run all tests**

Run: `cd packages/mcp && bun run test`
Expected: ALL PASS

- [ ] **Step 5: Verify build**

Run: `cd packages/mcp && bun run build`
Expected: Clean build, dist/ output with types

- [ ] **Step 6: Run typecheck**

Run: `cd packages/mcp && bun run typecheck`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/tests/integration.test.ts
git commit -m "feat(mcp): add integration tests and finalize exports"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/mcp && bun run test`
Expected: All tests pass (types, registry, validation, errors, timeout, protocol, transport, rest, openapi, server, integration)

- [ ] **Step 2: Run build**

Run: `cd packages/mcp && bun run build`
Expected: Clean dist/ output

- [ ] **Step 3: Run typecheck**

Run: `cd packages/mcp && bun run typecheck`
Expected: No errors

- [ ] **Step 4: Verify package exports**

Run: `cd packages/mcp && node -e "import('@workkit/mcp').then(m => console.log(Object.keys(m)))"`
Expected: Lists all exported functions and types

- [ ] **Step 5: Final commit**

```bash
git add -A packages/mcp/
git commit -m "feat(mcp): @workkit/mcp v0.1.0 — Hono for MCP"
```

---

## Summary

| Task | Module | Tests | Description |
|------|--------|-------|-------------|
| 1 | scaffolding | — | Package setup: package.json, tsconfig, vitest, bunup |
| 2 | types.ts | types.test.ts | All type definitions |
| 3 | registry.ts | registry.test.ts | Tool/Resource/Prompt registries with freeze |
| 4 | validation.ts | validation.test.ts | Standard Schema → validation + JSON Schema conversion |
| 5 | errors.ts | errors.test.ts | Error mapping: WorkkitError → MCP/JSON-RPC/REST |
| 6 | timeout.ts | timeout.test.ts | Tool execution timeout with AbortSignal |
| 7 | protocol.ts | protocol.test.ts | MCP JSON-RPC method dispatcher |
| 8 | transport.ts | transport.test.ts | Streamable HTTP transport (POST /mcp) |
| 9 | rest.ts | rest.test.ts | REST endpoint generation (POST /api/tools/*) |
| 10 | openapi.ts | openapi.test.ts | OpenAPI 3.1 spec generation |
| 11 | server.ts | server.test.ts | createMCPServer() builder |
| 12 | integration | integration.test.ts | End-to-end: MCP + REST + OpenAPI + health |
| 13 | — | — | Final verification: all tests, build, typecheck |

**Total: 13 tasks, ~80 steps. Each task produces a working, tested module.**

**Not included in v0.1.0 (deferred to v0.2.0):**
- Session management (Durable Object-backed sessions for subscriptions, progress, cancellation)
- SSE transport (GET /mcp for legacy clients)
- Auth middleware (MCPAuthConfig enforcement on transport layer)
- Swagger UI serving
- stdio transport (local dev)
- `logging/setLevel` method
- `completion/complete` method
- Resource subscriptions
- `createMCPTestClient` test helper (spec Section 7)
- `toHono()` is included as a type but implementation is minimal (returns internal Hono app) — full escape-hatch patterns deferred

**Known implementation risk:** Task 4 (validation.ts) `schemaToJsonSchema()` inspects Zod internals (`schema._def`). This is fragile across Zod versions, especially Zod 4.x. Consider using a lightweight conversion or the `zod-to-json-schema` package if internal inspection proves too brittle.
