import type { ColumnTransformer } from './types'

/**
 * Apply column name transformation to a single row.
 */
export function transformRow<T>(
  row: Record<string, unknown>,
  transform?: ColumnTransformer,
): T {
  if (!transform) return row as T

  const transformed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    transformed[transform(key)] = value
  }
  return transformed as T
}

/**
 * Apply column name transformation to an array of rows.
 */
export function transformResults<T>(
  results: Record<string, unknown>[],
  transform?: ColumnTransformer,
): T[] {
  if (!transform) return results as T[]
  return results.map((row) => transformRow<T>(row, transform))
}

/**
 * Built-in snake_case to camelCase transformer.
 */
export function snakeToCamel(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
