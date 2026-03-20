import type { EnvSchema, InferEnv } from '@workkit/env'
import type { LoaderFunctionArgs, TypedLoaderArgs } from './types'
import { createEnvFactory } from './env'

/**
 * Options for createLoader.
 */
export interface CreateLoaderOptions<T extends EnvSchema> {
  /** Environment schema to validate */
  env: T
}

/**
 * Creates a typed Remix loader with validated env access.
 *
 * The handler receives `{ request, params, env, context }` where
 * `env` is fully typed and validated against the schema.
 *
 * Return values are automatically serialized to JSON responses.
 * If a Response is returned directly, it passes through unchanged.
 *
 * @example
 * ```ts
 * import { createLoader } from '@workkit/remix'
 * import { z } from 'zod'
 *
 * const loader = createLoader(
 *   { env: { API_KEY: z.string().min(1) } },
 *   async ({ env, params }) => {
 *     return { key: env.API_KEY, id: params.id }
 *   },
 * )
 * ```
 */
export function createLoader<T extends EnvSchema, TReturn>(
  options: CreateLoaderOptions<T>,
  handler: (args: TypedLoaderArgs<InferEnv<T>>) => TReturn | Promise<TReturn>,
): (args: LoaderFunctionArgs) => Promise<Response>

/**
 * Creates a typed Remix loader without env validation.
 *
 * The handler receives `{ request, params, env, context }` where
 * `env` is the raw unvalidated environment bindings.
 *
 * @example
 * ```ts
 * const loader = createLoader(async ({ env, params, request }) => {
 *   return { id: params.id }
 * })
 * ```
 */
export function createLoader<TReturn>(
  handler: (args: TypedLoaderArgs<Record<string, unknown>>) => TReturn | Promise<TReturn>,
): (args: LoaderFunctionArgs) => Promise<Response>

export function createLoader<T extends EnvSchema, TReturn>(
  optionsOrHandler:
    | CreateLoaderOptions<T>
    | ((args: TypedLoaderArgs<Record<string, unknown>>) => TReturn | Promise<TReturn>),
  handler?: (args: TypedLoaderArgs<InferEnv<T>>) => TReturn | Promise<TReturn>,
): (args: LoaderFunctionArgs) => Promise<Response> {
  if (typeof optionsOrHandler === 'function') {
    // No env validation — raw env passthrough
    const fn = optionsOrHandler
    return async (args: LoaderFunctionArgs): Promise<Response> => {
      const result = await fn({
        request: args.request,
        params: args.params as Record<string, string | undefined>,
        env: args.context.cloudflare.env,
        context: args.context,
      })
      return toResponse(result)
    }
  }

  // With env validation
  const getEnv = createEnvFactory(optionsOrHandler.env)
  const fn = handler!

  return async (args: LoaderFunctionArgs): Promise<Response> => {
    const env = getEnv(args.context)
    const result = await fn({
      request: args.request,
      params: args.params as Record<string, string | undefined>,
      env,
      context: args.context,
    })
    return toResponse(result)
  }
}

function toResponse(value: unknown): Response {
  if (value instanceof Response) return value
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
}
