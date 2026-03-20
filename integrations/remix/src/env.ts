import { parseEnvSync } from '@workkit/env'
import type { EnvSchema, InferEnv } from '@workkit/env'
import type { CloudflareLoadContext } from './types'

/**
 * Creates a reusable env factory bound to a schema.
 * Validates and types the Cloudflare env from Remix's context.
 *
 * Validation is cached per context object — the schema is only
 * validated once even if getEnv() is called multiple times with
 * the same context.
 *
 * @example
 * ```ts
 * import { createEnvFactory } from '@workkit/remix'
 * import { z } from 'zod'
 *
 * const getEnv = createEnvFactory({
 *   API_KEY: z.string().min(1),
 * })
 *
 * export const loader = async ({ context }: LoaderFunctionArgs) => {
 *   const env = getEnv(context) // typed, validated
 * }
 * ```
 */
export function createEnvFactory<T extends EnvSchema>(
  schema: T,
): (context: CloudflareLoadContext) => InferEnv<T> {
  const cache = new WeakMap<CloudflareLoadContext, InferEnv<T>>()

  return (context: CloudflareLoadContext): InferEnv<T> => {
    const cached = cache.get(context)
    if (cached) return cached

    const rawEnv = context.cloudflare.env
    const parsed = parseEnvSync(rawEnv, schema)
    cache.set(context, parsed)
    return parsed
  }
}
