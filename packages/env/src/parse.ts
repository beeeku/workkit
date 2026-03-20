import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { EnvSchema, InferEnv } from './types'
import { ConfigError } from '@workkit/errors'
import { EnvValidationError, type EnvIssue } from './errors'

/**
 * Validates and parses environment bindings against a Standard Schema map.
 * Async — handles both sync and async validators.
 * Validates all fields in parallel and collects all issues before throwing.
 */
export async function parseEnv<T extends EnvSchema>(
  rawEnv: Record<string, unknown>,
  schema: T,
): Promise<InferEnv<T>> {
  const issues: EnvIssue[] = []
  const result: Record<string, unknown> = {}

  const entries = Object.entries(schema)
  const validations = await Promise.all(
    entries.map(async ([key, validator]) => {
      const value = rawEnv[key]
      const validatorResult = validator['~standard'].validate(value)
      const resolved =
        validatorResult instanceof Promise ? await validatorResult : validatorResult
      return { key, result: resolved, rawValue: value }
    }),
  )

  for (const { key, result: validationResult, rawValue } of validations) {
    if ('issues' in validationResult && validationResult.issues) {
      for (const issue of validationResult.issues) {
        issues.push({
          key,
          message: issue.message,
          path: issue.path,
          received: rawValue,
        })
      }
    } else {
      result[key] = (validationResult as { value: unknown }).value
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues)
  }

  return result as InferEnv<T>
}

/**
 * Synchronous version. Throws if any validator returns a Promise.
 * Preferred for env validation (almost always sync).
 * Collects all issues before throwing.
 */
export function parseEnvSync<T extends EnvSchema>(
  rawEnv: Record<string, unknown>,
  schema: T,
): InferEnv<T> {
  const issues: EnvIssue[] = []
  const result: Record<string, unknown> = {}

  for (const [key, validator] of Object.entries(schema)) {
    const value = rawEnv[key]
    const validationResult = validator['~standard'].validate(value)

    if (validationResult instanceof Promise) {
      throw new ConfigError(
        `Validator for "${key}" returned a Promise. Use parseEnv() (async) instead of parseEnvSync().`,
      )
    }

    if ('issues' in validationResult && validationResult.issues) {
      for (const issue of validationResult.issues) {
        issues.push({
          key,
          message: issue.message,
          path: issue.path,
          received: value,
        })
      }
    } else {
      result[key] = (validationResult as { value: unknown }).value
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues)
  }

  return result as InferEnv<T>
}

/**
 * Creates a reusable env parser bound to a schema.
 * Useful when the same schema is validated in multiple handlers.
 */
export function createEnvParser<T extends EnvSchema>(schema: T): {
  parse: (rawEnv: Record<string, unknown>) => Promise<InferEnv<T>>
  parseSync: (rawEnv: Record<string, unknown>) => InferEnv<T>
  schema: T
} {
  return {
    parse: (rawEnv: Record<string, unknown>): Promise<InferEnv<T>> => parseEnv(rawEnv, schema),
    parseSync: (rawEnv: Record<string, unknown>): InferEnv<T> => parseEnvSync(rawEnv, schema),
    schema: schema,
  }
}
