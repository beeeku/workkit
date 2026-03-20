import { D1Error, classifyD1Error } from "./errors";
import { transformResults, transformRow } from "./result";
import { extractRunResult } from "./run-result";
import type {
	ColumnTransformer,
	D1RunResult,
	DeleteBuilder,
	InsertBuilder,
	OnConflictAction,
	OrderDirection,
	ReturningBuilder,
	SelectBuilder,
	UpdateBuilder,
	WhereCondition,
	WhereOperator,
} from "./types";

interface CompiledWhere {
	sql: string;
	params: unknown[];
}

/**
 * Compile a WhereCondition into a SQL fragment and parameter array.
 */
export function compileWhere(condition: WhereCondition): CompiledWhere {
	// Object shorthand: { id: 1, active: true } -> "id = ? AND active = ?"
	if (!Array.isArray(condition) && typeof condition === "object") {
		const entries = Object.entries(condition);
		const clauses = entries.map(([key]) => `${escapeIdentifier(key)} = ?`);
		const params = entries.map(([, value]) => value);
		return { sql: clauses.join(" AND "), params };
	}

	// Tuple syntax
	if (Array.isArray(condition)) {
		const [column, operatorOrValue, value] = condition;

		// Two-element tuple
		if (condition.length === 2) {
			if (condition[1] === "IS NULL") {
				return { sql: `${escapeIdentifier(column)} IS NULL`, params: [] };
			}
			if (condition[1] === "IS NOT NULL") {
				return { sql: `${escapeIdentifier(column)} IS NOT NULL`, params: [] };
			}
			return { sql: `${escapeIdentifier(column)} = ?`, params: [operatorOrValue] };
		}

		// Three-element tuple with operator
		const op = operatorOrValue as WhereOperator;

		if (op === "IN" || op === "NOT IN") {
			const arr = value as unknown[];
			const placeholders = arr.map(() => "?").join(", ");
			return { sql: `${escapeIdentifier(column)} ${op} (${placeholders})`, params: arr };
		}

		if (op === "BETWEEN") {
			const [low, high] = value as [unknown, unknown];
			return { sql: `${escapeIdentifier(column)} BETWEEN ? AND ?`, params: [low, high] };
		}

		return { sql: `${escapeIdentifier(column)} ${op} ?`, params: [value] };
	}

	throw new D1Error("Invalid WHERE condition");
}

/**
 * Escape a column/table identifier to prevent SQL injection.
 * SQLite uses double quotes for identifiers.
 */
export function escapeIdentifier(name: string): string {
	if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
		return name;
	}
	return `"${name.replace(/"/g, '""')}"`;
}

// ─── SelectBuilder ────────────────────────────────────────────────────────────

export class SelectBuilderImpl<T> implements SelectBuilder<T> {
	private _table: string;
	private _columns: string[] = ["*"];
	private _wheres: CompiledWhere[] = [];
	private _whereJoiners: ("AND" | "OR")[] = [];
	private _orderBys: { column: string; direction: string }[] = [];
	private _limit?: number;
	private _offset?: number;
	private _groupBys: string[] = [];
	private _having?: { sql: string; params: unknown[] };
	private _db: D1Database;
	private _transform?: ColumnTransformer;

	constructor(db: D1Database, table: string, transform?: ColumnTransformer) {
		this._db = db;
		this._table = table;
		this._transform = transform;
	}

	columns(...cols: string[]): this {
		this._columns = cols;
		return this;
	}

	where(conditionOrSql: WhereCondition | string, params?: unknown[]): this {
		if (typeof conditionOrSql === "string") {
			this._wheres.push({ sql: conditionOrSql, params: params ?? [] });
		} else {
			this._wheres.push(compileWhere(conditionOrSql));
		}
		return this;
	}

	andWhere(conditionOrSql: WhereCondition | string, params?: unknown[]): this {
		this._whereJoiners.push("AND");
		return this.where(conditionOrSql, params);
	}

	orWhere(conditionOrSql: WhereCondition | string, params?: unknown[]): this {
		this._whereJoiners.push("OR");
		return this.where(conditionOrSql, params);
	}

	orderBy(column: string, direction: OrderDirection = "asc"): this {
		this._orderBys.push({ column, direction: direction.toUpperCase() });
		return this;
	}

	limit(count: number): this {
		this._limit = count;
		return this;
	}

	offset(count: number): this {
		this._offset = count;
		return this;
	}

	groupBy(...columns: string[]): this {
		this._groupBys = columns;
		return this;
	}

	having(sql: string, params?: unknown[]): this {
		this._having = { sql, params: params ?? [] };
		return this;
	}

	toSQL(): { sql: string; params: unknown[] } {
		const params: unknown[] = [];
		const parts: string[] = [];

		// SELECT
		const cols = this._columns
			.map((c) => (c === "*" || c.includes("(") ? c : escapeIdentifier(c)))
			.join(", ");
		parts.push(`SELECT ${cols} FROM ${escapeIdentifier(this._table)}`);

		// WHERE
		if (this._wheres.length > 0) {
			const whereParts: string[] = [];
			for (let i = 0; i < this._wheres.length; i++) {
				if (i > 0) {
					whereParts.push(this._whereJoiners[i - 1] ?? "AND");
				}
				whereParts.push(`(${this._wheres[i]!.sql})`);
				params.push(...this._wheres[i]!.params);
			}
			parts.push(`WHERE ${whereParts.join(" ")}`);
		}

		// GROUP BY
		if (this._groupBys.length > 0) {
			parts.push(`GROUP BY ${this._groupBys.map(escapeIdentifier).join(", ")}`);
		}

		// HAVING
		if (this._having) {
			parts.push(`HAVING ${this._having.sql}`);
			params.push(...this._having.params);
		}

		// ORDER BY
		if (this._orderBys.length > 0) {
			const orders = this._orderBys.map((o) => `${escapeIdentifier(o.column)} ${o.direction}`);
			parts.push(`ORDER BY ${orders.join(", ")}`);
		}

		// LIMIT / OFFSET
		if (this._limit !== undefined) {
			parts.push("LIMIT ?");
			params.push(this._limit);
		}
		if (this._offset !== undefined) {
			parts.push("OFFSET ?");
			params.push(this._offset);
		}

		return { sql: parts.join(" "), params };
	}

	async all(): Promise<T[]> {
		const { sql, params } = this.toSQL();
		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const result = await stmt.all();
			return transformResults<T>(
				(result.results ?? []) as Record<string, unknown>[],
				this._transform,
			);
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}

	async first(): Promise<T | null> {
		if (this._limit === undefined) this._limit = 1;
		const { sql, params } = this.toSQL();
		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const row = await stmt.first();
			if (!row) return null;
			return transformRow<T>(row as Record<string, unknown>, this._transform);
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}

	async count(): Promise<number> {
		const saved = this._columns;
		this._columns = ["COUNT(*) as count"];
		const { sql, params } = this.toSQL();
		this._columns = saved;

		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const row = await stmt.first<{ count: number }>();
			return row?.count ?? 0;
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}
}

// ─── InsertBuilder ────────────────────────────────────────────────────────────

export class InsertBuilderImpl implements InsertBuilder {
	private _table: string;
	private _data: Record<string, unknown>[] = [];
	private _conflictAction?: "ignore" | "replace";
	private _conflictColumns?: string[];
	private _conflictDoAction?: OnConflictAction;
	private _returningCols?: string[];
	private _db: D1Database;
	private _transform?: ColumnTransformer;

	constructor(db: D1Database, table: string, transform?: ColumnTransformer) {
		this._db = db;
		this._table = table;
		this._transform = transform;
	}

	values(data: Record<string, unknown> | Record<string, unknown>[]): this {
		if (Array.isArray(data)) {
			this._data = data;
		} else {
			this._data = [data];
		}
		return this;
	}

	onConflict(actionOrColumns: "ignore" | "replace" | string[], action?: OnConflictAction): this {
		if (typeof actionOrColumns === "string") {
			this._conflictAction = actionOrColumns;
		} else {
			this._conflictColumns = actionOrColumns;
			this._conflictDoAction = action;
		}
		return this;
	}

	returning<R = Record<string, unknown>>(...columns: string[]): ReturningBuilder<R> {
		this._returningCols = columns;
		return createReturningBuilder<R>(this._db, () => this.toSQL(), this._transform);
	}

	toSQL(): { sql: string; params: unknown[] } {
		if (this._data.length === 0) {
			throw new D1Error("INSERT requires at least one row of values");
		}

		const columns = Object.keys(this._data[0]!);
		const params: unknown[] = [];
		const valuePlaceholders: string[] = [];

		for (const row of this._data) {
			const placeholders = columns.map(() => "?");
			valuePlaceholders.push(`(${placeholders.join(", ")})`);
			for (const col of columns) {
				params.push(row[col]);
			}
		}

		const colsSql = columns.map(escapeIdentifier).join(", ");
		let sql: string;

		if (this._conflictAction === "ignore") {
			sql = `INSERT OR IGNORE INTO ${escapeIdentifier(this._table)} (${colsSql}) VALUES ${valuePlaceholders.join(", ")}`;
		} else if (this._conflictAction === "replace") {
			sql = `INSERT OR REPLACE INTO ${escapeIdentifier(this._table)} (${colsSql}) VALUES ${valuePlaceholders.join(", ")}`;
		} else {
			sql = `INSERT INTO ${escapeIdentifier(this._table)} (${colsSql}) VALUES ${valuePlaceholders.join(", ")}`;
		}

		// ON CONFLICT with columns
		if (this._conflictColumns && this._conflictDoAction) {
			const conflictCols = this._conflictColumns.map(escapeIdentifier).join(", ");
			if (this._conflictDoAction.do === "nothing") {
				sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
			} else if (this._conflictDoAction.do === "update" && this._conflictDoAction.set) {
				const setEntries = Object.entries(this._conflictDoAction.set);
				const setClauses = setEntries.map(([key]) => `${escapeIdentifier(key)} = ?`);
				for (const [, value] of setEntries) {
					params.push(value);
				}
				sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClauses.join(", ")}`;
			}
		}

		// RETURNING
		if (this._returningCols) {
			const retCols = this._returningCols
				.map((c) => (c === "*" ? "*" : escapeIdentifier(c)))
				.join(", ");
			sql += ` RETURNING ${retCols}`;
		}

		return { sql, params };
	}

	async run(): Promise<D1RunResult> {
		const { sql, params } = this.toSQL();
		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const result = await stmt.run();
			return extractRunResult(result);
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}
}

// ─── UpdateBuilder ────────────────────────────────────────────────────────────

export class UpdateBuilderImpl implements UpdateBuilder {
	private _table: string;
	private _setData: Record<string, unknown> = {};
	private _wheres: CompiledWhere[] = [];
	private _whereJoiners: ("AND" | "OR")[] = [];
	private _returningCols?: string[];
	private _db: D1Database;
	private _transform?: ColumnTransformer;

	constructor(db: D1Database, table: string, transform?: ColumnTransformer) {
		this._db = db;
		this._table = table;
		this._transform = transform;
	}

	set(data: Record<string, unknown>): this {
		this._setData = { ...this._setData, ...data };
		return this;
	}

	where(conditionOrSql: WhereCondition | string, params?: unknown[]): this {
		if (typeof conditionOrSql === "string") {
			this._wheres.push({ sql: conditionOrSql, params: params ?? [] });
		} else {
			this._wheres.push(compileWhere(conditionOrSql));
		}
		return this;
	}

	returning<R = Record<string, unknown>>(...columns: string[]): ReturningBuilder<R> {
		this._returningCols = columns;
		return createReturningBuilder<R>(this._db, () => this.toSQL(), this._transform);
	}

	toSQL(): { sql: string; params: unknown[] } {
		const params: unknown[] = [];
		const setEntries = Object.entries(this._setData);
		const setClauses = setEntries.map(([key]) => `${escapeIdentifier(key)} = ?`);
		for (const [, value] of setEntries) {
			params.push(value);
		}

		let sql = `UPDATE ${escapeIdentifier(this._table)} SET ${setClauses.join(", ")}`;

		// WHERE
		if (this._wheres.length > 0) {
			const whereParts: string[] = [];
			for (let i = 0; i < this._wheres.length; i++) {
				if (i > 0) {
					whereParts.push(this._whereJoiners[i - 1] ?? "AND");
				}
				whereParts.push(`(${this._wheres[i]!.sql})`);
				params.push(...this._wheres[i]!.params);
			}
			sql += ` WHERE ${whereParts.join(" ")}`;
		}

		// RETURNING
		if (this._returningCols) {
			const retCols = this._returningCols
				.map((c) => (c === "*" ? "*" : escapeIdentifier(c)))
				.join(", ");
			sql += ` RETURNING ${retCols}`;
		}

		return { sql, params };
	}

	async run(): Promise<D1RunResult> {
		if (this._wheres.length === 0) {
			throw new D1Error(
				"UPDATE without WHERE is not allowed. Use .where() to specify conditions, or use raw SQL via db.run() for full-table updates.",
			);
		}

		const { sql, params } = this.toSQL();
		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const result = await stmt.run();
			return extractRunResult(result);
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}
}

// ─── DeleteBuilder ────────────────────────────────────────────────────────────

export class DeleteBuilderImpl implements DeleteBuilder {
	private _table: string;
	private _wheres: CompiledWhere[] = [];
	private _whereJoiners: ("AND" | "OR")[] = [];
	private _returningCols?: string[];
	private _db: D1Database;
	private _transform?: ColumnTransformer;

	constructor(db: D1Database, table: string, transform?: ColumnTransformer) {
		this._db = db;
		this._table = table;
		this._transform = transform;
	}

	where(conditionOrSql: WhereCondition | string, params?: unknown[]): this {
		if (typeof conditionOrSql === "string") {
			this._wheres.push({ sql: conditionOrSql, params: params ?? [] });
		} else {
			this._wheres.push(compileWhere(conditionOrSql));
		}
		return this;
	}

	returning<R = Record<string, unknown>>(...columns: string[]): ReturningBuilder<R> {
		this._returningCols = columns;
		return createReturningBuilder<R>(this._db, () => this.toSQL(), this._transform);
	}

	toSQL(): { sql: string; params: unknown[] } {
		const params: unknown[] = [];
		let sql = `DELETE FROM ${escapeIdentifier(this._table)}`;

		// WHERE
		if (this._wheres.length > 0) {
			const whereParts: string[] = [];
			for (let i = 0; i < this._wheres.length; i++) {
				if (i > 0) {
					whereParts.push(this._whereJoiners[i - 1] ?? "AND");
				}
				whereParts.push(`(${this._wheres[i]!.sql})`);
				params.push(...this._wheres[i]!.params);
			}
			sql += ` WHERE ${whereParts.join(" ")}`;
		}

		// RETURNING
		if (this._returningCols) {
			const retCols = this._returningCols
				.map((c) => (c === "*" ? "*" : escapeIdentifier(c)))
				.join(", ");
			sql += ` RETURNING ${retCols}`;
		}

		return { sql, params };
	}

	async run(): Promise<D1RunResult> {
		if (this._wheres.length === 0) {
			throw new D1Error(
				"DELETE without WHERE is not allowed. Use .where() to specify conditions, or use raw SQL via db.run() for full-table deletes.",
			);
		}

		const { sql, params } = this.toSQL();
		try {
			const stmt = this._db.prepare(sql).bind(...params);
			const result = await stmt.run();
			return extractRunResult(result);
		} catch (error) {
			throw classifyD1Error(error, sql, params);
		}
	}
}

// ─── ReturningBuilder ────────────────────────────────────────────────────────

function createReturningBuilder<T>(
	db: D1Database,
	toSQLFn: () => { sql: string; params: unknown[] },
	transform?: ColumnTransformer,
): ReturningBuilder<T> {
	return {
		toSQL: toSQLFn,

		async all(): Promise<T[]> {
			const { sql, params } = toSQLFn();
			try {
				const stmt = db.prepare(sql).bind(...params);
				const result = await stmt.all();
				return transformResults<T>((result.results ?? []) as Record<string, unknown>[], transform);
			} catch (error) {
				throw classifyD1Error(error, sql, params);
			}
		},

		async first(): Promise<T | null> {
			const { sql, params } = toSQLFn();
			try {
				const stmt = db.prepare(sql).bind(...params);
				const row = await stmt.first();
				if (!row) return null;
				return transformRow<T>(row as Record<string, unknown>, transform);
			} catch (error) {
				throw classifyD1Error(error, sql, params);
			}
		},
	};
}
