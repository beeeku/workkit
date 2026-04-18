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

function classify(sql: string): "read" | "write" | "delete" | null {
	const head = sql.trimStart().slice(0, 16).toUpperCase();
	if (head.startsWith("SELECT")) return "read";
	if (head.startsWith("INSERT") || head.startsWith("UPDATE")) return "write";
	if (head.startsWith("DELETE")) return "delete";
	return null;
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
		const returns = /\bRETURNING\b/i.test(sql);
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
			adapter.exec(sql);
			const count = sql
				.split(";")
				.map((s) => s.trim())
				.filter(Boolean).length;
			return { count, duration: 0.1 };
		},

		dump: async () => new ArrayBuffer(0),
	};

	return db as unknown as D1Database & MockOperations & ErrorInjection;
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
