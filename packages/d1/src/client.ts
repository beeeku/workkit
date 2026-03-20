import { BindingNotFoundError } from "@workkit/errors";
import { executeBatch } from "./batch";
import { classifyD1Error } from "./errors";
import { createTypedPreparedStatement } from "./prepared";
import {
	DeleteBuilderImpl,
	InsertBuilderImpl,
	SelectBuilderImpl,
	UpdateBuilderImpl,
} from "./query";
import { snakeToCamel, transformResults, transformRow } from "./result";
import { extractRunResult } from "./run-result";
import type {
	BoundStatement,
	ColumnTransformer,
	D1BatchResult,
	D1ExecResult,
	D1Options,
	D1RunResult,
	DeleteBuilder,
	InsertBuilder,
	SelectBuilder,
	TypedD1,
	TypedPreparedStatement,
	UpdateBuilder,
} from "./types";

/**
 * Create a typed D1 client from a D1Database binding.
 *
 * Provides first/all/run/exec helpers, prepared statements, a fluent
 * query builder (select/insert/update/delete), and optional column transforms.
 *
 * @param binding - The D1Database binding from the worker env.
 * @param options - Optional config: transformColumns ('camelCase' or custom fn), logQueries.
 * @returns A TypedD1 client with query methods and a fluent builder API.
 *
 * @example
 * ```ts
 * const db = d1(env.DB, { transformColumns: 'camelCase' })
 * const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [id])
 * const rows = await db.select<User>('users').where('active = ?', [true]).all()
 * ```
 */
export function d1(binding: D1Database, options?: D1Options): TypedD1 {
	if (!binding) {
		throw new BindingNotFoundError("D1Database binding is null or undefined");
	}

	const transform: ColumnTransformer | undefined =
		options?.transformColumns === "camelCase"
			? snakeToCamel
			: typeof options?.transformColumns === "function"
				? options.transformColumns
				: undefined;

	const logQueries = options?.logQueries ?? false;

	function log(sql: string, params?: unknown[]) {
		if (logQueries) {
			console.log("[D1]", sql, params?.length ? params : "");
		}
	}

	return {
		async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
			log(sql, params);
			const bindParams = params ?? [];
			try {
				const stmt = binding.prepare(sql).bind(...bindParams);
				const row = await stmt.first();
				if (!row) return null;
				return transformRow<T>(row as Record<string, unknown>, transform);
			} catch (error) {
				throw classifyD1Error(error, sql, bindParams);
			}
		},

		async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
			log(sql, params);
			const bindParams = params ?? [];
			try {
				const stmt = binding.prepare(sql).bind(...bindParams);
				const result = await stmt.all();
				return transformResults<T>((result.results ?? []) as Record<string, unknown>[], transform);
			} catch (error) {
				throw classifyD1Error(error, sql, bindParams);
			}
		},

		async run(sql: string, params?: unknown[]): Promise<D1RunResult> {
			log(sql, params);
			const bindParams = params ?? [];
			try {
				const stmt = binding.prepare(sql).bind(...bindParams);
				const result = await stmt.run();
				return extractRunResult(result);
			} catch (error) {
				throw classifyD1Error(error, sql, bindParams);
			}
		},

		async exec(sql: string): Promise<D1ExecResult> {
			log(sql);
			try {
				const result = await binding.exec(sql);
				const r = result as { count?: number; duration?: number };
				return {
					count: r.count ?? 0,
					duration: r.duration ?? 0,
				};
			} catch (error) {
				throw classifyD1Error(error, sql);
			}
		},

		prepare<T = Record<string, unknown>>(
			sql: string,
			params?: unknown[],
		): TypedPreparedStatement<T> {
			log(sql, params);
			return createTypedPreparedStatement<T>(binding, sql, params, transform);
		},

		async batch(statements: BoundStatement[]): Promise<D1BatchResult[]> {
			return executeBatch(binding, statements);
		},

		select<T = Record<string, unknown>>(table: string): SelectBuilder<T> {
			return new SelectBuilderImpl<T>(binding, table, transform);
		},

		insert(table: string): InsertBuilder {
			return new InsertBuilderImpl(binding, table, transform);
		},

		update(table: string): UpdateBuilder {
			return new UpdateBuilderImpl(binding, table, transform);
		},

		delete(table: string): DeleteBuilder {
			return new DeleteBuilderImpl(binding, table, transform);
		},

		get raw(): D1Database {
			return binding;
		},
	};
}
