import type { EnvSchema, InferEnv } from '@workkit/env'

// ---------------------------------------------------------------------------
// Minimal Astro type interfaces
// We define these ourselves to avoid depending on the full astro package.
// Users must have astro >= 4.0.0 installed as a peer dependency.
// ---------------------------------------------------------------------------

/**
 * Minimal representation of Astro's APIContext.
 * The actual Astro APIContext has many more fields, but these are
 * all we need for env/binding extraction on Cloudflare Pages.
 */
export interface AstroAPIContext {
  /** The incoming request */
  request: Request
  /** Adapter-specific locals — Cloudflare Pages stores runtime here */
  locals: AstroLocals
}

/**
 * Shape of `context.locals` when running on Cloudflare Pages via @astrojs/cloudflare.
 * The adapter injects `runtime` with the Cloudflare execution context.
 */
export interface AstroLocals {
  runtime?: CloudflareRuntime
  [key: string]: unknown
}

/**
 * The Cloudflare runtime object injected by @astrojs/cloudflare adapter.
 */
export interface CloudflareRuntime {
  env: Record<string, unknown>
  cf?: IncomingRequestCfProperties
  ctx?: ExecutionContext
}

/**
 * Minimal subset of CF request properties we expose.
 * Kept deliberately narrow — users can cast to the full type if needed.
 */
export interface CfProperties {
  country?: string
  city?: string
  continent?: string
  latitude?: string
  longitude?: string
  region?: string
  regionCode?: string
  timezone?: string
  postalCode?: string
  colo?: string
  httpProtocol?: string
  tlsVersion?: string
  asn?: number
  asOrganization?: string
  [key: string]: unknown
}

/**
 * Configuration for the workkitMiddleware.
 */
export interface WorkkitMiddlewareOptions<T extends EnvSchema> {
  /** Environment schema to validate against */
  env: T
  /** Custom error handler — called when env validation fails */
  onError?: (error: Error, context: AstroAPIContext) => Response | Promise<Response>
}

/**
 * The env accessor function returned by defineEnv.
 */
export interface EnvAccessor<T extends EnvSchema> {
  /** Extract and validate env from an Astro API context */
  (context: AstroAPIContext): InferEnv<T>
  /** The underlying schema (useful for passing to middleware) */
  schema: T
}

/**
 * Minimal Astro MiddlewareHandler signature.
 * Matches Astro's onRequest type for Cloudflare Pages.
 */
export type AstroMiddlewareHandler = (
  context: AstroAPIContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>
