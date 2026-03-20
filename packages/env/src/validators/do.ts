import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface DOValidatorOptions {
  /** Custom error message when binding is missing or invalid */
  message?: string
}

/**
 * Creates a Standard Schema validator for DurableObjectNamespace bindings.
 *
 * @example
 * ```ts
 * import { durableObject } from '@workkit/env/validators'
 * const schema = { COUNTER: durableObject() }
 * ```
 */
export function durableObject(
  options?: DOValidatorOptions,
): StandardSchemaV1<DurableObjectNamespace, DurableObjectNamespace> {
  return {
    '~standard': {
      version: 1,
      vendor: 'workkit',
      validate(value): StandardSchemaV1.Result<DurableObjectNamespace> {
        if (!isDurableObjectNamespace(value)) {
          return {
            issues: [
              {
                message:
                  options?.message ??
                  'Expected a DurableObjectNamespace binding. Ensure this binding is configured in wrangler.toml under [durable_objects].',
              },
            ],
          }
        }
        return { value: value as DurableObjectNamespace }
      },
    },
  }
}

function isDurableObjectNamespace(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.get === 'function' &&
    typeof obj.idFromName === 'function' &&
    typeof obj.idFromString === 'function'
  )
}
