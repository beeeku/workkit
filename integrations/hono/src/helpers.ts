import type { Context } from 'hono'
import type { EnvSchema, InferEnv } from '@workkit/env'
import type { WorkkitEnv } from './types'

/**
 * Get the validated, typed environment from Hono context.
 *
 * Requires the workkit() middleware to have run first.
 * Throws if env has not been validated yet.
 *
 * @example
 * ```ts
 * app.get('/test', (c) => {
 *   const env = getEnv(c)
 *   return c.json({ key: env.API_KEY })
 * })
 * ```
 */
export function getEnv<T extends EnvSchema>(
  c: Context<WorkkitEnv<T>>,
): InferEnv<T> {
  const validated = c.get('workkit:envValidated')
  if (!validated) {
    throw new Error(
      'workkit:env is not available. Did you forget to add the workkit() middleware?',
    )
  }
  return c.get('workkit:env')
}
