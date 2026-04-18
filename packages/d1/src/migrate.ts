import { ValidationError } from "@workkit/errors";
import { D1MigrationError } from "./errors";

export interface Migration {
	/** Migration identifier (e.g., '001_create_users') */
	name: string;
	/** SQL to execute */
	sql: string;
}

export interface MigrationOptions {
	/** Table name for tracking applied migrations (default: '_migrations') */
	tableName?: string;
	/** Log migration execution (default: false) */
	log?: boolean;
}

export interface MigrationResult {
	applied: number;
	pending: number;
	migrations: MigrationRunResult[];
}

export interface MigrationRunResult {
	name: string;
	success: boolean;
}

/**
 * Run pending migrations against a D1 database.
 * Migrations are applied in order. Already-applied migrations are skipped.
 */
export async function migrate(
	db: D1Database,
	migrations: Migration[],
	options?: MigrationOptions,
): Promise<MigrationResult> {
	const tableName = options?.tableName ?? "_migrations";
	validateTableName(tableName);
	const log = options?.log ?? false;

	// Ensure migration tracking table exists
	await db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

	// Get already-applied migrations
	const applied = await db.prepare(`SELECT name FROM ${tableName} ORDER BY id`).all();
	const appliedNames = new Set(((applied.results ?? []) as { name: string }[]).map((r) => r.name));

	// Find pending migrations
	const pending = migrations.filter((m) => !appliedNames.has(m.name));

	if (pending.length === 0) {
		return { applied: 0, pending: 0, migrations: [] };
	}

	const results: MigrationRunResult[] = [];

	for (const migration of pending) {
		try {
			if (log) console.log(`Applying migration: ${migration.name}`); // constitution-allow:console-log reason="opt-in migration trace, gated by log flag"

			await db.exec(migration.sql);
			await db.prepare(`INSERT INTO ${tableName} (name) VALUES (?)`).bind(migration.name).run();

			results.push({ name: migration.name, success: true });
		} catch (error) {
			throw new D1MigrationError(
				migration.name,
				error instanceof Error ? error.message : String(error),
				{ cause: error },
			);
		}
	}

	return {
		applied: results.length,
		pending: migrations.length - appliedNames.size - results.length,
		migrations: results,
	};
}

/**
 * Get migration status without applying anything.
 */
export async function migrationStatus(
	db: D1Database,
	migrations: Migration[],
	options?: MigrationOptions,
): Promise<{
	applied: string[];
	pending: string[];
	total: number;
}> {
	const tableName = options?.tableName ?? "_migrations";
	validateTableName(tableName);

	try {
		const applied = await db.prepare(`SELECT name FROM ${tableName} ORDER BY id`).all();
		const appliedNames = new Set(
			((applied.results ?? []) as { name: string }[]).map((r) => r.name),
		);

		return {
			applied: [...appliedNames],
			pending: migrations.filter((m) => !appliedNames.has(m.name)).map((m) => m.name),
			total: migrations.length,
		};
	} catch {
		// Table doesn't exist -- all migrations are pending
		return {
			applied: [],
			pending: migrations.map((m) => m.name),
			total: migrations.length,
		};
	}
}

/**
 * Validate that a table name is a safe SQL identifier.
 * Prevents SQL injection via tableName parameter.
 */
function validateTableName(name: string): void {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		throw new ValidationError(
			`Invalid migration table name "${name}": must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
		);
	}
}
