import { BindingNotFoundError } from '@workkit/errors'
import type { AstroAPIContext } from './types'
import { getCloudflareRuntime } from './context'

/**
 * Gets a typed binding from the Cloudflare runtime env.
 * Provides type-safe access to D1, KV, R2, Durable Objects,
 * and other Cloudflare bindings.
 *
 * Throws BindingNotFoundError if the binding doesn't exist,
 * making it clear which binding is misconfigured.
 *
 * @example
 * ```ts
 * import { getBinding } from '@workkit/astro'
 *
 * export async function GET(context: APIContext) {
 *   const db = getBinding<D1Database>(context, 'DB')
 *   const kv = getBinding<KVNamespace>(context, 'CACHE')
 * }
 * ```
 */
export function getBinding<T = unknown>(
  context: AstroAPIContext,
  name: string,
): T {
  const runtime = getCloudflareRuntime(context)
  const binding = runtime.env[name]

  if (binding === undefined) {
    throw new BindingNotFoundError(name)
  }

  return binding as T
}

/**
 * Gets a binding from the Cloudflare runtime env, returning undefined
 * if not found instead of throwing. Useful for optional bindings.
 *
 * @example
 * ```ts
 * import { getOptionalBinding } from '@workkit/astro'
 *
 * export async function GET(context: APIContext) {
 *   const analytics = getOptionalBinding<AnalyticsEngineDataset>(context, 'ANALYTICS')
 *   if (analytics) {
 *     analytics.writeDataPoint({ blobs: ['page_view'] })
 *   }
 * }
 * ```
 */
export function getOptionalBinding<T = unknown>(
  context: AstroAPIContext,
  name: string,
): T | undefined {
  const runtime = context.locals?.runtime
  if (!runtime) return undefined
  const binding = runtime.env[name]
  return binding === undefined ? undefined : (binding as T)
}
