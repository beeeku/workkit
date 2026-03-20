/**
 * Options for creating a D1 client.
 */
export interface D1Options {
	/** Log queries to console (default: false) */
	logQueries?: boolean;

	/** Transform column names in results (e.g., snake_case to camelCase) */
	transformColumns?: ColumnTransformer | "camelCase";

	/** Default timeout for queries in ms */
	queryTimeout?: number;
}

/**
 * Column name transformer function.
 */
export type ColumnTransformer = (column: string) => string;

/**
 * The typed D1 client interface.
 */
export interface TypedD1 {
	/** Query a single row. Returns null if no rows match. */
	first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

	/** Query all matching rows. Returns empty array if no matches. */
	all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

	/** Execute a mutation. Returns run metadata (changes, duration, etc). */
	run(sql: string, params?: unknown[]): Promise<D1RunResult>;

	/** Execute raw SQL (DDL, multi-statement). No parameter binding. */
	exec(sql: string): Promise<D1ExecResult>;

	/** Create a reusable prepared statement. */
	prepare<T = Record<string, unknown>>(sql: string, params?: unknown[]): TypedPreparedStatement<T>;

	/** Execute multiple statements atomically. */
	batch(statements: BoundStatement[]): Promise<D1BatchResult[]>;

	/** Start building a SELECT query. */
	select<T = Record<string, unknown>>(table: string): SelectBuilder<T>;

	/** Start building an INSERT query. */
	insert(table: string): InsertBuilder;

	/** Start building an UPDATE query. */
	update(table: string): UpdateBuilder;

	/** Start building a DELETE query. */
	delete(table: string): DeleteBuilder;

	/** The underlying D1Database binding (escape hatch). */
	readonly raw: D1Database;
}

/**
 * Result of a mutation (INSERT, UPDATE, DELETE).
 */
export interface D1RunResult {
	success: boolean;
	meta: D1Meta;
}

/**
 * D1 query metadata.
 */
export interface D1Meta {
	changed_db: boolean;
	changes: number;
	duration: number;
	last_row_id: number;
	rows_read: number;
	rows_written: number;
	size_after: number;
}

/**
 * Result of exec() -- raw SQL execution.
 */
export interface D1ExecResult {
	count: number;
	duration: number;
}

/**
 * Result of a single statement in a batch.
 */
export interface D1BatchResult {
	results: unknown[];
	success: boolean;
	meta: D1Meta;
}

/**
 * A bound prepared statement ready for batch execution.
 */
export interface BoundStatement {
	/** The underlying D1PreparedStatement (already bound with params) */
	readonly statement: D1PreparedStatement;
}

/**
 * A typed prepared statement.
 * Reusable across multiple executions with different parameters.
 */
export interface TypedPreparedStatement<T = Record<string, unknown>> {
	/** Execute and return first row. */
	first(params?: unknown[]): Promise<T | null>;

	/** Execute and return all rows. */
	all(params?: unknown[]): Promise<T[]>;

	/** Execute a mutation. */
	run(params?: unknown[]): Promise<D1RunResult>;

	/** Bind parameters and return a BoundStatement for batch operations. */
	bind(params: unknown[]): BoundStatement;

	/** The raw SQL string. */
	readonly sql: string;
}

/**
 * WHERE clause conditions.
 */
export type WhereCondition =
	| Record<string, unknown>
	| [string, unknown]
	| [string, WhereOperator, unknown]
	| [string, "IN", unknown[]]
	| [string, "BETWEEN", [unknown, unknown]]
	| [string, "IS NULL"]
	| [string, "IS NOT NULL"];

export type WhereOperator =
	| "="
	| "!="
	| "<"
	| ">"
	| "<="
	| ">="
	| "LIKE"
	| "NOT LIKE"
	| "IN"
	| "NOT IN"
	| "BETWEEN"
	| "IS NULL"
	| "IS NOT NULL";

export type OrderDirection = "asc" | "desc" | "ASC" | "DESC";

/**
 * SELECT query builder.
 */
export interface SelectBuilder<T> {
	columns(...cols: string[]): SelectBuilder<T>;
	where(condition: WhereCondition): SelectBuilder<T>;
	where(sql: string, params?: unknown[]): SelectBuilder<T>;
	andWhere(condition: WhereCondition): SelectBuilder<T>;
	andWhere(sql: string, params?: unknown[]): SelectBuilder<T>;
	orWhere(condition: WhereCondition): SelectBuilder<T>;
	orWhere(sql: string, params?: unknown[]): SelectBuilder<T>;
	orderBy(column: string, direction?: OrderDirection): SelectBuilder<T>;
	limit(count: number): SelectBuilder<T>;
	offset(count: number): SelectBuilder<T>;
	groupBy(...columns: string[]): SelectBuilder<T>;
	having(sql: string, params?: unknown[]): SelectBuilder<T>;

	/** Execute and return all matching rows. */
	all(): Promise<T[]>;
	/** Execute and return the first matching row. */
	first(): Promise<T | null>;
	/** Execute and return count of matching rows. */
	count(): Promise<number>;
	/** Build the SQL string without executing (for debugging). */
	toSQL(): { sql: string; params: unknown[] };
}

/**
 * INSERT query builder.
 */
export interface InsertBuilder {
	values(data: Record<string, unknown>): InsertBuilder;
	values(data: Record<string, unknown>[]): InsertBuilder;
	onConflict(action: "ignore" | "replace"): InsertBuilder;
	onConflict(columns: string[], action: OnConflictAction): InsertBuilder;
	returning<T = Record<string, unknown>>(...columns: string[]): ReturningBuilder<T>;

	/** Execute the insert. */
	run(): Promise<D1RunResult>;
	/** Build the SQL string without executing. */
	toSQL(): { sql: string; params: unknown[] };
}

export interface OnConflictAction {
	do: "nothing" | "update";
	set?: Record<string, unknown>;
}

/**
 * UPDATE query builder.
 */
export interface UpdateBuilder {
	set(data: Record<string, unknown>): UpdateBuilder;
	where(condition: WhereCondition): UpdateBuilder;
	where(sql: string, params?: unknown[]): UpdateBuilder;
	returning<T = Record<string, unknown>>(...columns: string[]): ReturningBuilder<T>;

	/** Execute the update. */
	run(): Promise<D1RunResult>;
	/** Build the SQL string without executing. */
	toSQL(): { sql: string; params: unknown[] };
}

/**
 * DELETE query builder.
 */
export interface DeleteBuilder {
	where(condition: WhereCondition): DeleteBuilder;
	where(sql: string, params?: unknown[]): DeleteBuilder;
	returning<T = Record<string, unknown>>(...columns: string[]): ReturningBuilder<T>;

	/** Execute the delete. */
	run(): Promise<D1RunResult>;
	/** Build the SQL string without executing. */
	toSQL(): { sql: string; params: unknown[] };
}

/**
 * RETURNING clause builder.
 */
export interface ReturningBuilder<T> {
	/** Execute and return all returned rows. */
	all(): Promise<T[]>;
	/** Execute and return the first returned row. */
	first(): Promise<T | null>;
	/** Build the SQL string without executing. */
	toSQL(): { sql: string; params: unknown[] };
}
