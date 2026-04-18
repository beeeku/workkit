import { type SqliteAdapter, openAdapter } from "./adapter";
import { type ErrorInjection, createErrorInjector } from "./error-injection";
import { type MockOperations, createOperationTracker } from "./observable";

interface MockD1Meta {
	changed_db: boolean;
	changes: number;
	duration: number;
	last_row_id: number;
	rows_read: number;
	rows_written: number;
	size_after: number;
}

function mockMeta(overrides?: Partial<MockD1Meta>): MockD1Meta {
	return {
		changed_db: false,
		changes: 0,
		duration: 0.1,
		last_row_id: 0,
		rows_read: 0,
		rows_written: 0,
		size_after: 0,
		...overrides,
	};
}

// Strip SQL string literals ('…') and quoted identifiers ("…") so keyword-
// scanning regexes don't hit false positives inside user data.
function stripLiterals(sql: string): string {
	return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

// Scan past a leading WITH […AS (…)][,…] CTE list, returning the offset of the
// statement head (SELECT/INSERT/UPDATE/DELETE) that follows. Respects nested
// parens and string literals.
function skipCte(sql: string): number {
	let i = sql.search(/\S/);
	if (i < 0 || !/^WITH\b/i.test(sql.slice(i))) return 0;
	i += 4;
	if (/^\s+RECURSIVE\b/i.test(sql.slice(i))) i += sql.slice(i).match(/^\s+RECURSIVE/i)![0].length;
	while (i < sql.length) {
		// skip until opening paren of a CTE body
		while (i < sql.length && sql[i] !== "(") i++;
		if (i >= sql.length) break;
		let depth = 1;
		i++;
		while (i < sql.length && depth > 0) {
			const ch = sql[i];
			if (ch === "'" || ch === '"') {
				const q = ch;
				i++;
				while (i < sql.length && sql[i] !== q) i++;
				i++;
				continue;
			}
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
			i++;
		}
		// after the CTE body: either a comma (more CTEs) or the statement head
		while (i < sql.length && /\s/.test(sql[i] as string)) i++;
		if (sql[i] === ",") {
			i++;
			continue;
		}
		return i;
	}
	return 0;
}

function classify(sql: string): "read" | "write" | "delete" | null {
	const clean = stripLiterals(sql);
	const offset = skipCte(clean);
	const head = clean.slice(offset).trimStart().slice(0, 16).toUpperCase();
	if (head.startsWith("SELECT") || head.startsWith("PRAGMA")) return "read";
	if (head.startsWith("INSERT") || head.startsWith("UPDATE") || head.startsWith("REPLACE"))
		return "write";
	if (head.startsWith("DELETE")) return "delete";
	return null;
}

function hasReturning(sql: string): boolean {
	return /\bRETURNING\b/i.test(stripLiterals(sql));
}

function quoteId(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

function normalize(v: unknown): unknown {
	if (v === undefined) return null;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (v instanceof Date) return v.toISOString();
	return v;
}

function seed(
	adapter: SqliteAdapter,
	initialTables: Record<string, Record<string, unknown>[]>,
): void {
	for (const [name, rows] of Object.entries(initialTables)) {
		const first = rows[0];
		if (!first) continue;
		const cols = Object.keys(first);
		const quotedCols = cols.map(quoteId).join(", ");
		adapter.exec(`CREATE TABLE ${quoteId(name)} (${quotedCols})`);
		const placeholders = cols.map(() => "?").join(", ");
		const stmt = adapter.prepare(
			`INSERT INTO ${quoteId(name)} (${quotedCols}) VALUES (${placeholders})`,
		);
		for (const row of rows) {
			stmt.run(...cols.map((c) => normalize(row[c])));
		}
	}
}

export function createMockD1(
	initialTables?: Record<string, Record<string, unknown>[]>,
): D1Database & MockOperations & ErrorInjection {
	const adapter = openAdapter();
	const tracker = createOperationTracker();
	const injector = createErrorInjector();

	if (initialTables) seed(adapter, initialTables);

	function runSql(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const cls = classify(sql);
		if (cls) tracker._record(cls);

		const normalized = params.map(normalize);
		const returns = hasReturning(sql);
		const isSelect = cls === "read";

		const stmt = adapter.prepare(sql);
		if (isSelect || returns) {
			const rows = stmt.all(...normalized);
			return {
				results: rows,
				meta: mockMeta({
					changed_db: !isSelect && rows.length > 0,
					changes: isSelect ? 0 : rows.length,
					rows_read: isSelect ? rows.length : 0,
					rows_written: isSelect ? 0 : rows.length,
				}),
			};
		}

		const r = stmt.run(...normalized);
		return {
			results: [],
			meta: mockMeta({
				changed_db: true,
				changes: r.changes,
				last_row_id: Number(r.lastInsertRowid ?? 0),
				rows_written: r.changes,
			}),
		};
	}

	interface BoundStatement {
		bind(...p: unknown[]): BoundStatement;
		first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
		all<T = Record<string, unknown>>(): Promise<{
			results: T[];
			success: boolean;
			meta: MockD1Meta;
		}>;
		run(): Promise<{ success: boolean; meta: MockD1Meta }>;
		raw<T = unknown[]>(): Promise<T[]>;
		_sql: string;
		_params: unknown[];
	}

	function createStatement(sql: string, boundParams: unknown[] = []): BoundStatement {
		return {
			bind(...newParams: unknown[]) {
				return createStatement(sql, newParams);
			},
			async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
				await injector._check();
				const { results } = runSql(sql, boundParams);
				const row = results[0] ?? null;
				if (row && colName) {
					const v = (row as Record<string, unknown>)[colName];
					return (v ?? null) as T | null;
				}
				return row as T | null;
			},
			async all<T = Record<string, unknown>>() {
				await injector._check();
				const result = runSql(sql, boundParams);
				return { results: result.results as T[], success: true, meta: result.meta };
			},
			async run() {
				await injector._check();
				const result = runSql(sql, boundParams);
				return { success: true, meta: result.meta };
			},
			async raw<T = unknown[]>(): Promise<T[]> {
				await injector._check();
				const { results } = runSql(sql, boundParams);
				return results.map((r) => Object.values(r)) as T[];
			},
			_sql: sql,
			_params: boundParams,
		};
	}

	const db = {
		get operations() {
			return tracker.operations;
		},
		reads: tracker.reads.bind(tracker),
		writes: tracker.writes.bind(tracker),
		deletes: tracker.deletes.bind(tracker),
		reset: tracker.reset.bind(tracker),
		failAfter: injector.failAfter.bind(injector),
		failOn: injector.failOn.bind(injector),
		withLatency: injector.withLatency.bind(injector),
		clearInjections: injector.clearInjections.bind(injector),

		prepare(sql: string) {
			return createStatement(sql);
		},

		async batch(statements: BoundStatement[]) {
			adapter.exec("BEGIN");
			try {
				const out: unknown[] = [];
				for (const stmt of statements) {
					await injector._check(stmt._sql);
					const r = runSql(stmt._sql, stmt._params ?? []);
					out.push({ results: r.results, success: true, meta: r.meta });
				}
				adapter.exec("COMMIT");
				return out;
			} catch (err) {
				try {
					adapter.exec("ROLLBACK");
				} catch {}
				throw err;
			}
		},

		async exec(sql: string): Promise<{ count: number; duration: number }> {
			await injector._check(sql);
			adapter.exec(sql);
			const count = sql
				.split(";")
				.map((s) => s.trim())
				.filter(Boolean).length;
			return { count, duration: 0.1 };
		},

		dump: async () => new ArrayBuffer(0),

		close() {
			adapter.close();
		},
		[Symbol.dispose]() {
			adapter.close();
		},
	};

	return db as unknown as D1Database &
		MockOperations &
		ErrorInjection & { close(): void; [Symbol.dispose](): void };
}

export function createFailingD1(error: Error | string): D1Database {
	const err = typeof error === "string" ? new Error(error) : error;

	const failStmt = {
		bind(..._params: unknown[]) {
			return failStmt;
		},
		first: async () => {
			throw err;
		},
		all: async () => {
			throw err;
		},
		run: async () => {
			throw err;
		},
		raw: async () => {
			throw err;
		},
	};

	return {
		prepare: () => failStmt,
		batch: async () => {
			throw err;
		},
		exec: async () => {
			throw err;
		},
		dump: async () => {
			throw err;
		},
	} as unknown as D1Database;
}
