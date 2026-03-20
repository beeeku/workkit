import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface D1ValidatorOptions {
  /** Custom error message when binding is missing or invalid */
  message?: string
}

/**
 * Creates a Standard Schema validator for D1Database bindings.
 * Uses duck-typing to verify the binding has the expected methods.
 *
 * @example
 * ```ts
 * import { d1 } from '@workkit/env/validators'
 * const schema = { DB: d1() }
 * ```
 */
export function d1(options?: D1ValidatorOptions): StandardSchemaV1<D1Database, D1Database> {
  return {
    '~standard': {
      version: 1,
      vendor: 'workkit',
      validate(value): StandardSchemaV1.Result<D1Database> {
        if (!isD1Database(value)) {
          return {
            issues: [
              {
                message:
                  options?.message ??
                  'Expected a D1Database binding. Ensure this binding is configured in wrangler.toml under [[d1_databases]].',
              },
            ],
          }
        }
        return { value: value as D1Database }
      },
    },
  }
}

function isD1Database(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.prepare === 'function' &&
    typeof obj.batch === 'function' &&
    typeof obj.exec === 'function'
  )
}
