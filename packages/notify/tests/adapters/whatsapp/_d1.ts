import Database from "better-sqlite3";
import {
	WA_INBOUND_LOG_MIGRATION_SQL,
	WA_MEDIA_CACHE_MIGRATION_SQL,
	WA_OPTIN_MIGRATION_SQL,
} from "../../../src/adapters/whatsapp/schema";
import type { NotifyD1, NotifyPreparedStatement } from "../../../src/types";

export function createWaDb(): NotifyD1 & { __raw: Database.Database } {
	const db = new Database(":memory:");
	for (const migration of [
		WA_OPTIN_MIGRATION_SQL,
		WA_MEDIA_CACHE_MIGRATION_SQL,
		WA_INBOUND_LOG_MIGRATION_SQL,
	]) {
		for (const stmt of split(migration)) db.exec(stmt);
	}
	const wrapped = wrap(db) as NotifyD1 & { __raw: Database.Database };
	wrapped.__raw = db;
	return wrapped;
}

function split(sql: string): string[] {
	return sql
		.split(/;\s*\n+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function wrap(db: Database.Database): NotifyD1 {
	return {
		prepare(query: string): NotifyPreparedStatement {
			return new Stmt(db, query, []);
		},
		async batch() {
			throw new Error("batch not supported");
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
		return (this.db.prepare(this.query).get(...sanitize(this.values)) as T | null) ?? null;
	}
	async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
		return { results: this.db.prepare(this.query).all(...sanitize(this.values)) as T[] };
	}
	async run(): Promise<{ success?: boolean; meta?: { changes?: number } }> {
		const result = this.db.prepare(this.query).run(...sanitize(this.values));
		return { success: true, meta: { changes: Number(result.changes ?? 0) } };
	}
}

function sanitize(values: unknown[]): unknown[] {
	return values.map((v) => (v === undefined ? null : v));
}
