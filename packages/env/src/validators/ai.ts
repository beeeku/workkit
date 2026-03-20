import type { StandardSchemaV1 } from '@standard-schema/spec'

export interface AiValidatorOptions {
  /** Custom error message when binding is missing or invalid */
  message?: string
}

/**
 * Creates a Standard Schema validator for Ai bindings.
 *
 * @example
 * ```ts
 * import { ai } from '@workkit/env/validators'
 * const schema = { AI: ai() }
 * ```
 */
export function ai(
  options?: AiValidatorOptions,
): StandardSchemaV1<Ai, Ai> {
  return {
    '~standard': {
      version: 1,
      vendor: 'workkit',
      validate(value): StandardSchemaV1.Result<Ai> {
        if (!isAi(value)) {
          return {
            issues: [
              {
                message:
                  options?.message ??
                  'Expected an Ai binding. Ensure this binding is configured in wrangler.toml under [ai].',
              },
            ],
          }
        }
        return { value: value as Ai }
      },
    },
  }
}

function isAi(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.run === 'function'
}
