import { ConfigError } from '@workkit/errors'
import type { AstroAPIContext, CfProperties, CloudflareRuntime } from './types'

/**
 * Extracts the Cloudflare runtime from an Astro API context.
 * Throws a descriptive error if the runtime is not available
 * (e.g., running without @astrojs/cloudflare adapter).
 *
 * @internal Shared by env, bindings, and context helpers.
 */
export function getCloudflareRuntime(context: AstroAPIContext): CloudflareRuntime {
  const runtime = context.locals?.runtime
  if (!runtime) {
    throw new ConfigError(
      '@workkit/astro: Cloudflare runtime not found in context.locals.runtime. ' +
        'Make sure you are using @astrojs/cloudflare adapter and the project is ' +
        'deployed to Cloudflare Pages.',
    )
  }
  return runtime
}

/**
 * Returns the Cloudflare request properties (cf object) from the context.
 * Returns undefined if not available (e.g., in local dev without cf simulation).
 *
 * @example
 * ```ts
 * import { getCFProperties } from '@workkit/astro'
 *
 * export async function GET(context: APIContext) {
 *   const cf = getCFProperties(context)
 *   return new Response(`Hello from ${cf?.country}`)
 * }
 * ```
 */
export function getCFProperties(context: AstroAPIContext): CfProperties | undefined {
  const runtime = context.locals?.runtime
  if (!runtime?.cf) return undefined
  return runtime.cf as unknown as CfProperties
}

/**
 * Returns the `waitUntil` function from the Cloudflare execution context.
 * Useful for running background tasks that should complete after the response
 * is sent (analytics, logging, cache warming, etc.).
 *
 * Throws if the execution context is not available.
 *
 * @example
 * ```ts
 * import { getWaitUntil } from '@workkit/astro'
 *
 * export async function GET(context: APIContext) {
 *   const waitUntil = getWaitUntil(context)
 *   waitUntil(logAnalytics(context.request))
 *   return new Response('ok')
 * }
 * ```
 */
export function getWaitUntil(
  context: AstroAPIContext,
): (promise: Promise<unknown>) => void {
  const runtime = getCloudflareRuntime(context)
  if (!runtime.ctx?.waitUntil) {
    throw new ConfigError(
      '@workkit/astro: ExecutionContext.waitUntil not available. ' +
        'Make sure the Cloudflare runtime provides an execution context.',
    )
  }
  return runtime.ctx.waitUntil.bind(runtime.ctx)
}
