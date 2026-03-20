/** Supported JWT signing algorithms */
export type JWTAlgorithm = 'HS256' | 'HS384' | 'HS512'

/** JWT header */
export interface JWTHeader {
  alg: JWTAlgorithm
  typ: 'JWT'
}

/** Standard JWT claims */
export interface JWTStandardClaims {
  /** Subject */
  sub?: string
  /** Issuer */
  iss?: string
  /** Audience */
  aud?: string | string[]
  /** Expiration time (Unix timestamp) */
  exp?: number
  /** Not before (Unix timestamp) */
  nbf?: number
  /** Issued at (Unix timestamp) */
  iat?: number
  /** JWT ID */
  jti?: string
}

/** Options for signing a JWT */
export interface SignJWTOptions {
  /** HMAC secret key */
  secret: string
  /** Signing algorithm (default: HS256) */
  algorithm?: JWTAlgorithm
  /** Expiration duration string (e.g. '1h', '30m', '7d') */
  expiresIn?: string
  /** Issuer claim */
  issuer?: string
  /** Audience claim */
  audience?: string | string[]
  /** Not before duration string */
  notBefore?: string
  /** JWT ID */
  jwtId?: string
}

/** Options for verifying a JWT */
export interface VerifyJWTOptions {
  /** HMAC secret key */
  secret: string
  /** Allowed algorithms (default: ['HS256']) */
  algorithms?: JWTAlgorithm[]
  /** Expected issuer */
  issuer?: string
  /** Expected audience */
  audience?: string | string[]
  /** Clock tolerance in seconds (default: 0) */
  clockTolerance?: number
}

/** Decoded JWT (without verification) */
export interface DecodedJWT<T = Record<string, unknown>> {
  header: JWTHeader
  payload: T & JWTStandardClaims
  signature: string
}

/** Auth handler configuration */
export interface AuthHandlerConfig<T> {
  /** Verify the request and return auth context, or null if unauthenticated */
  verify: (request: Request, env: unknown) => Promise<T | null>
  /** Response to return when auth is required but missing */
  unauthorized?: () => Response
  /** Response to return when auth exists but access is denied */
  forbidden?: () => Response
}

/** A worker fetch handler with typed auth context */
export type AuthenticatedHandler<T, Env = unknown> = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  authCtx: T,
) => Response | Promise<Response>

/** A worker fetch handler with optional auth context */
export type OptionalAuthHandler<T, Env = unknown> = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  authCtx: T | null,
) => Response | Promise<Response>

/** Auth handler instance */
export interface AuthHandler<T> {
  /** Require authentication — returns 401 if not authenticated */
  required: <Env = unknown>(
    handler: AuthenticatedHandler<T, Env>,
  ) => (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>

  /** Optional authentication — handler receives null if not authenticated */
  optional: <Env = unknown>(
    handler: OptionalAuthHandler<T, Env>,
  ) => (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>

  /** Require a specific role — returns 403 if role doesn't match */
  requireRole: <Env = unknown>(
    role: T extends { role: string } ? T['role'] : string,
    handler: AuthenticatedHandler<T, Env>,
  ) => (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
}

/** Session configuration */
export interface SessionConfig {
  /** KV namespace for session storage */
  store: KVNamespace
  /** Session TTL in seconds (default: 86400 = 24h) */
  ttl?: number
  /** Cookie name (default: 'session_id') */
  cookieName?: string
  /** Set Secure flag on cookie (default: true) */
  secure?: boolean
  /** SameSite cookie attribute (default: 'Lax') */
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** Cookie domain */
  domain?: string
  /** Cookie path (default: '/') */
  path?: string
}

/** Session with typed data */
export interface Session<T> {
  id: string
  data: T
  createdAt: number
  expiresAt: number
}

/** Result of creating a session */
export interface CreateSessionResult {
  sessionId: string
  cookie: string
}

/** Session manager instance */
export interface SessionManager<T> {
  /** Create a new session */
  create: (data: T) => Promise<CreateSessionResult>

  /** Get a session by ID */
  get: (sessionId: string) => Promise<Session<T> | null>

  /** Get session from request cookie */
  fromRequest: (request: Request) => Promise<Session<T> | null>

  /** Update session data */
  update: (sessionId: string, data: T) => Promise<void>

  /** Destroy a session */
  destroy: (sessionId: string) => Promise<void>
}

/** Basic auth credentials */
export interface BasicAuthCredentials {
  username: string
  password: string
}

/** Password hash format (PBKDF2) */
export interface PasswordHash {
  hash: string
  salt: string
  iterations: number
  algorithm: string
}
