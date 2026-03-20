import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface ServiceValidatorOptions {
  /** Custom error message when binding is missing or invalid */
  message?: string
}

/**
 * Creates a Standard Schema validator for Service (Fetcher) bindings.
 *
 * @example
 * ```ts
 * import { service } from '@workkit/env/validators'
 * const schema = { AUTH_SERVICE: service() }
 * ```
 */
export function service(
  options?: ServiceValidatorOptions,
): StandardSchemaV1<Fetcher, Fetcher> {
  return {
    '~standard': {
      version: 1,
      vendor: 'workkit',
      validate(value): StandardSchemaV1.Result<Fetcher> {
        if (!isFetcher(value)) {
          return {
            issues: [
              {
                message:
                  options?.message ??
                  'Expected a Service binding (Fetcher). Ensure this binding is configured in wrangler.toml under [[services]].',
              },
            ],
          }
        }
        return { value: value as Fetcher }
      },
    },
  }
}

function isFetcher(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.fetch === 'function'
}
