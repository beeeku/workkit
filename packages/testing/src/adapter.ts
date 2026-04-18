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

export function openAdapter(): SqliteAdapter {
	// Construct `require` lazily inside the function so merely importing this
	// module is safe in runtimes without `node:module` (e.g. workerd). The
	// function itself still only works under Bun or Node >=22.
	const req = createRequire(import.meta.url);
	const bun = (globalThis as { Bun?: unknown }).Bun;
	if (typeof bun !== "undefined") {
		const { Database } = req("bun:sqlite") as {
			Database: new (path: string) => UnderlyingDb;
		};
		return wrap(new Database(":memory:"));
	}
	try {
		const { DatabaseSync } = req("node:sqlite") as {
			DatabaseSync: new (path: string) => UnderlyingDb;
		};
		return wrap(new DatabaseSync(":memory:"));
	} catch (cause) {
		throw new Error("createMockD1 requires Node >=22 for node:sqlite", { cause });
	}
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
