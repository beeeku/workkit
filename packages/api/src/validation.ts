import { ValidationError } from '@workkit/errors'
import type { ValidationIssue } from '@workkit/errors'
import type { StandardSchemaV1, StandardSchemaV1Issue } from './types'

/**
 * Validate a value against a Standard Schema.
 * Returns the validated (and possibly transformed) output.
 * Throws ValidationError on failure.
 */
export async function validate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  label: string = 'value',
): Promise<T> {
  const result = await schema['~standard'].validate(value)

  if (result.issues) {
    const issues = normalizeIssues(result.issues, label)
    throw new ValidationError(
      `Invalid ${label}`,
      issues,
    )
  }

  return result.value
}

/**
 * Validate a value synchronously if the schema supports it.
 * Falls back to async validation.
 */
export function validateSync<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  label: string = 'value',
): T {
  const result = schema['~standard'].validate(value)

  // If it returns a promise, this can't be used synchronously
  if (result instanceof Promise) {
    throw new Error(
      `Schema validation for ${label} returned a Promise. Use validate() instead of validateSync().`,
    )
  }

  if (result.issues) {
    const issues = normalizeIssues(result.issues, label)
    throw new ValidationError(
      `Invalid ${label}`,
      issues,
    )
  }

  return result.value
}

/**
 * Try to validate a value — returns a result object instead of throwing.
 */
export async function tryValidate<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): Promise<
  | { success: true; value: T }
  | { success: false; issues: ValidationIssue[] }
> {
  const result = await schema['~standard'].validate(value)

  if (result.issues) {
    return {
      success: false,
      issues: normalizeIssues(result.issues, 'value'),
    }
  }

  return { success: true, value: result.value }
}

/**
 * Check if a value implements the Standard Schema v1 interface.
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof (value as any)['~standard'] === 'object' &&
    (value as any)['~standard'].version === 1
  )
}

/** Convert Standard Schema issues to ValidationIssue[] */
function normalizeIssues(
  issues: ReadonlyArray<StandardSchemaV1Issue>,
  label: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path
      ? issue.path.map((p) =>
          typeof p === 'object' && p !== null && 'key' in p
            ? String(p.key)
            : String(p),
        )
      : [label],
    message: issue.message,
  }))
}
