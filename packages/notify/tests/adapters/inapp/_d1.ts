import Database from "better-sqlite3";
import { INAPP_MIGRATION_SQL } from "../../../src/adapters/inapp/schema";
import type { NotifyD1, NotifyPreparedStatement } from "../../../src/types";

/**
 * Real SQLite-backed `NotifyD1` mock for in-app tests. Lets us test against
 * actual SQL semantics (`ORDER BY`, `IS NULL`, composite predicates) without
 * writing a SQL parser. `better-sqlite3` works under both `bun test` and
 * vitest-on-node.
 */
export function createInAppDb(): NotifyD1 & { __raw: Database.Database } {
	const db = new Database(":memory:");
	for (const stmt of splitStatements(INAPP_MIGRATION_SQL)) db.exec(stmt);
	const wrapped = wrap(db) as NotifyD1 & { __raw: Database.Database };
	wrapped.__raw = db;
	return wrapped;
}

function splitStatements(sql: string): string[] {
	return sql
		.split(/;\s*\n+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function wrap(db: Database.Database): NotifyD1 {
	return {
		prepare(query: string): NotifyPreparedStatement {
			return new Stmt(db, query, []);
		},
		async batch() {
			throw new Error("batch not supported in test mock");
		},
	};
}

class Stmt implements NotifyPreparedStatement {
	constructor(
		private db: Database.Database,
		private query: string,
		private values: unknown[],
	) {}
	bind(...values: unknown[]): NotifyPreparedStatement {
		return new Stmt(this.db, this.query, values);
	}
	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const stmt = this.db.prepare(this.query);
		const row = stmt.get(...sanitize(this.values));
		return (row as T | null) ?? null;
	}
	async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
		const stmt = this.db.prepare(this.query);
		const rows = stmt.all(...sanitize(this.values));
		return { results: rows as T[] };
	}
	async run(): Promise<{ success?: boolean; meta?: { changes?: number } }> {
		const stmt = this.db.prepare(this.query);
		const result = stmt.run(...sanitize(this.values));
		return { success: true, meta: { changes: Number(result.changes ?? 0) } };
	}
}

function sanitize(values: unknown[]): unknown[] {
	return values.map((v) => (v === undefined ? null : v));
}
