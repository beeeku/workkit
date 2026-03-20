import type {
  TypedPreparedStatement,
  BoundStatement,
  D1RunResult,
  ColumnTransformer,
} from './types'
import { transformRow, transformResults } from './result'
import { classifyD1Error } from './errors'
import { extractRunResult } from './run-result'

/**
 * Create a typed prepared statement wrapper around D1Database.
 */
export function createTypedPreparedStatement<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  initialParams?: unknown[],
  transform?: ColumnTransformer,
): TypedPreparedStatement<T> {
  return {
    get sql() {
      return sql
    },

    async first(params?: unknown[]): Promise<T | null> {
      const bindParams = params ?? initialParams ?? []
      try {
        const stmt = db.prepare(sql).bind(...bindParams)
        const row = await stmt.first()
        if (!row) return null
        return transformRow<T>(row as Record<string, unknown>, transform)
      } catch (error) {
        throw classifyD1Error(error, sql, bindParams)
      }
    },

    async all(params?: unknown[]): Promise<T[]> {
      const bindParams = params ?? initialParams ?? []
      try {
        const stmt = db.prepare(sql).bind(...bindParams)
        const result = await stmt.all()
        return transformResults<T>(
          (result.results ?? []) as Record<string, unknown>[],
          transform,
        )
      } catch (error) {
        throw classifyD1Error(error, sql, bindParams)
      }
    },

    async run(params?: unknown[]): Promise<D1RunResult> {
      const bindParams = params ?? initialParams ?? []
      try {
        const stmt = db.prepare(sql).bind(...bindParams)
        const result = await stmt.run()
        return extractRunResult(result)
      } catch (error) {
        throw classifyD1Error(error, sql, bindParams)
      }
    },

    bind(params: unknown[]): BoundStatement {
      const stmt = db.prepare(sql).bind(...params)
      return { statement: stmt as unknown as D1PreparedStatement }
    },
  }
}
