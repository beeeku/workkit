import type { MaybePromise } from '@workkit/types'

// --- Standard Schema v1 interface ---
// See: https://github.com/standard-schema/standard-schema

/** Standard Schema v1 issue */
export interface StandardSchemaV1Issue {
  readonly message: string
  readonly path?: ReadonlyArray<
    | PropertyKey
    | { readonly key: PropertyKey }
  >
}

/** Standard Schema v1 result */
export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaV1Issue>; readonly value?: undefined }

/** Standard Schema v1 interface — compatible with Zod, Valibot, ArkType, etc. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
  }
  /** Type-level input brand */
  readonly '~types'?: { readonly input: Input; readonly output: Output }
}

/** Infer the output type of a Standard Schema */
export type InferOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : never

/** Infer the input type of a Standard Schema */
export type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never

// --- HTTP Method ---

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

// --- Path parameter extraction ---

/** Extract parameter names from a path pattern like '/users/:id/posts/:postId' */
export type ExtractPathParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractPathParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? Param
      : never

/** Build a record of extracted path params */
export type PathParamRecord<Path extends string> =
  [ExtractPathParams<Path>] extends [never]
    ? Record<string, never>
    : Record<ExtractPathParams<Path>, string>

// --- API Definition ---

/** Configuration for a single API endpoint */
export interface ApiConfig<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TResponse extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  /** HTTP method */
  method: TMethod
  /** URL path pattern (e.g., '/users/:id') */
  path: TPath
  /** Path parameter schema */
  params?: TParams
  /** Query string schema */
  query?: TQuery
  /** Request body schema (for POST/PUT/PATCH) */
  body?: TBody
  /** Response body schema */
  response?: TResponse
  /** Request handler */
  handler: ApiHandler<TMethod, TPath, TParams, TQuery, TBody, TResponse, TEnv>
  /** Middleware to apply before the handler */
  middleware?: Middleware<TEnv>[]
}

/** Handler context passed to api handler functions */
export interface HandlerContext<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TBody extends StandardSchemaV1 | undefined = undefined,
  _TResponse extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  /** Validated path parameters */
  params: TParams extends StandardSchemaV1 ? InferOutput<TParams> : PathParamRecord<TPath>
  /** Validated query parameters */
  query: TQuery extends StandardSchemaV1 ? InferOutput<TQuery> : Record<string, string>
  /** Validated request body */
  body: TBody extends StandardSchemaV1 ? InferOutput<TBody> : undefined
  /** Worker environment bindings */
  env: TEnv
  /** Original Request object */
  request: Request
  /** HTTP method */
  method: TMethod
  /** Matched path */
  path: TPath
  /** Request headers */
  headers: Headers
}

/** API handler function */
export type ApiHandler<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TResponse extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> = (
  ctx: HandlerContext<TMethod, TPath, TParams, TQuery, TBody, TResponse, TEnv>,
) => MaybePromise<TResponse extends StandardSchemaV1 ? InferOutput<TResponse> : unknown>

/** A defined API endpoint (result of api() call) */
export interface ApiDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TResponse extends StandardSchemaV1 | undefined = undefined,
  TEnv = unknown,
> {
  readonly __brand: 'ApiDefinition'
  readonly method: TMethod
  readonly path: TPath
  readonly params?: TParams
  readonly query?: TQuery
  readonly body?: TBody
  readonly response?: TResponse
  readonly handler: ApiHandler<TMethod, TPath, TParams, TQuery, TBody, TResponse, TEnv>
  readonly middleware: Middleware<TEnv>[]
}

// --- Middleware ---

/** Next function for middleware chains */
export type MiddlewareNext = () => MaybePromise<Response>

/** Middleware function */
export type Middleware<TEnv = unknown> = (
  request: Request,
  env: TEnv,
  next: MiddlewareNext,
) => MaybePromise<Response>

// --- Router ---

/** Router configuration */
export interface RouterConfig<TEnv = unknown> {
  /** API definitions to register */
  apis: ApiDefinition<any, any, any, any, any, any, TEnv>[]
  /** Global middleware applied to all routes */
  middleware?: Middleware<TEnv>[]
  /** Custom error handler */
  onError?: (error: unknown, request: Request) => MaybePromise<Response>
  /** Base path prefix for all routes (e.g., '/api/v1') */
  basePath?: string
  /** Custom CORS configuration */
  cors?: CorsConfig | boolean
  /** Whether to validate response bodies against schemas (default: false in production) */
  validateResponses?: boolean
}

/** CORS configuration */
export interface CorsConfig {
  origin: string | string[] | ((origin: string) => boolean)
  methods?: HttpMethod[]
  allowHeaders?: string[]
  exposeHeaders?: string[]
  maxAge?: number
  credentials?: boolean
}

/** Router instance returned by createRouter() */
export interface Router<TEnv = unknown> {
  /** Handle a fetch request */
  fetch: (request: Request, env: TEnv, ctx?: any) => Promise<Response>
  /** All registered API definitions */
  readonly routes: ReadonlyArray<ApiDefinition<any, any, any, any, any, any, TEnv>>
}

// --- OpenAPI ---

/** OpenAPI generation config */
export interface OpenAPIConfig {
  title: string
  version: string
  description?: string
  servers?: Array<{ url: string; description?: string }>
  apis: ApiDefinition<any, any, any, any, any, any, any>[]
}

// --- Client ---

/** Client configuration */
export interface ClientConfig {
  /** Base URL for API calls */
  baseUrl: string
  /** Default headers to include in every request */
  headers?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof globalThis.fetch
}

/** Extract client methods from a router's API definitions */
export type ClientMethods<TRouter> = TRouter extends Router<any>
  ? {
      [K in TRouter['routes'][number] as ExtractEndpointName<K['path']>]: ClientMethod<K>
    }
  : never

/** Extract a meaningful name from a path */
type ExtractEndpointName<Path> = Path extends `/${infer Name}`
  ? CleanPathName<Name>
  : Path extends string
    ? Path
    : never

/** Clean path name by removing parameters and slashes */
type CleanPathName<S extends string> =
  S extends `${infer Part}/${infer Rest}`
    ? Part extends `:${string}`
      ? CleanPathName<Rest>
      : `${Part}${Capitalize<CleanPathName<Rest>>}`
    : S extends `:${string}`
      ? ''
      : S

/** Client method for a single API definition */
type ClientMethod<TDef> = TDef extends ApiDefinition<
  infer _M,
  infer _P,
  infer _Params,
  infer _Query,
  infer _Body,
  infer TResponse,
  any
>
  ? (
      input: ClientInput<TDef>,
    ) => Promise<TResponse extends StandardSchemaV1 ? InferOutput<TResponse> : unknown>
  : never

/** Input required for a client method call */
type ClientInput<TDef> = TDef extends ApiDefinition<
  infer _M,
  infer TPath,
  infer TParams,
  infer TQuery,
  infer TBody,
  any,
  any
>
  ? (TParams extends StandardSchemaV1 ? { params: InferInput<TParams> } : ExtractPathParams<TPath & string> extends never ? {} : { params: PathParamRecord<TPath & string> })
    & (TQuery extends StandardSchemaV1 ? { query: InferInput<TQuery> } : {})
    & (TBody extends StandardSchemaV1 ? { body: InferInput<TBody> } : {})
  : never

// --- Path parsing ---

/** Parsed path structure */
export interface ParsedPath {
  /** All segments of the path */
  segments: string[]
  /** Parameter names (without ':' prefix) */
  params: string[]
  /** The original path pattern */
  pattern: string
}

/** Path match result */
export type PathMatch =
  | { matched: true; params: Record<string, string> }
  | { matched: false; params?: undefined }
