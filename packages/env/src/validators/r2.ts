import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface R2ValidatorOptions {
  /** Custom error message when binding is missing or invalid */
  message?: string
}

/**
 * Creates a Standard Schema validator for R2Bucket bindings.
 *
 * @example
 * ```ts
 * import { r2 } from '@workkit/env/validators'
 * const schema = { STORAGE: r2() }
 * ```
 */
export function r2(options?: R2ValidatorOptions): StandardSchemaV1<R2Bucket, R2Bucket> {
  return {
    '~standard': {
      version: 1,
      vendor: 'workkit',
      validate(value): StandardSchemaV1.Result<R2Bucket> {
        if (!isR2Bucket(value)) {
          return {
            issues: [
              {
                message:
                  options?.message ??
                  'Expected an R2Bucket binding. Ensure this binding is configured in wrangler.toml under [[r2_buckets]].',
              },
            ],
          }
        }
        return { value: value as R2Bucket }
      },
    },
  }
}

function isR2Bucket(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.get === 'function' &&
    typeof obj.put === 'function' &&
    typeof obj.delete === 'function' &&
    typeof obj.list === 'function' &&
    typeof obj.head === 'function'
  )
}
