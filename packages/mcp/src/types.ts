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

// ─── Logger ───────────────────────────────────────────────────

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
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
