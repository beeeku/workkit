import { parseEnvSync, createEnvParser } from '@workkit/env'
import type { EnvSchema, InferEnv } from '@workkit/env'
import { ConfigError } from '@workkit/errors'
import type { AstroAPIContext, EnvAccessor } from './types'
import { getCloudflareRuntime } from './context'

/**
 * Creates a typed env accessor for Astro on Cloudflare Pages.
 *
 * The returned function extracts the Cloudflare runtime env from
 * `context.locals.runtime.env`, validates it against the schema,
 * and returns a fully typed result. Validation runs on every call
 * but is synchronous (Standard Schema validators are sync by convention).
 *
 * Results are cached per-context to avoid re-validation within the
 * same request lifecycle.
 *
 * @example
 * ```ts
 * import { defineEnv } from '@workkit/astro'
 * import { z } from 'zod'
 * import { d1, kv } from '@workkit/env/validators'
 *
 * export const env = defineEnv({
 *   DB: d1(),
 *   CACHE: kv(),
 *   API_KEY: z.string().min(1),
 * })
 *
 * // In an API route:
 * export async function GET(context: APIContext) {
 *   const { DB, API_KEY } = env(context)
 * }
 * ```
 */
export function defineEnv<T extends EnvSchema>(schema: T): EnvAccessor<T> {
  const parser = createEnvParser(schema)
  const cache = new WeakMap<AstroAPIContext, InferEnv<T>>()

  const accessor = (context: AstroAPIContext): InferEnv<T> => {
    const cached = cache.get(context)
    if (cached) return cached

    const runtime = getCloudflareRuntime(context)
    const rawEnv = runtime.env
    const parsed = parser.parseSync(rawEnv)
    cache.set(context, parsed)
    return parsed
  }

  accessor.schema = schema

  return accessor as EnvAccessor<T>
}
