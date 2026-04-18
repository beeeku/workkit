import { createRequire } from "node:module";

export interface SqliteStatement {
	run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
	all(...params: unknown[]): Record<string, unknown>[];
	get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface SqliteAdapter {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

interface UnderlyingDb {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

const req = createRequire(import.meta.url);

export function openAdapter(): SqliteAdapter {
	const bun = (globalThis as { Bun?: unknown }).Bun;
	if (typeof bun !== "undefined") {
		const { Database } = req("bun:sqlite") as {
			Database: new (path: string) => UnderlyingDb;
		};
		return wrap(new Database(":memory:"));
	}
	const { DatabaseSync } = req("node:sqlite") as {
		DatabaseSync: new (path: string) => UnderlyingDb;
	};
	return wrap(new DatabaseSync(":memory:"));
}

function wrap(db: UnderlyingDb): SqliteAdapter {
	return {
		exec: (sql) => db.exec(sql),
		prepare: (sql) => {
			const stmt = db.prepare(sql);
			return {
				run: (...params) => stmt.run(...params),
				all: (...params) => stmt.all(...params),
				get: (...params) => stmt.get(...params),
			};
		},
		close: () => db.close(),
	};
}
