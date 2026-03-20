import { D1BatchError } from "./errors";
import type { BoundStatement, D1BatchResult, D1Meta } from "./types";

/**
 * Execute a batch of prepared statements atomically.
 */
export async function executeBatch(
	db: D1Database,
	statements: BoundStatement[],
): Promise<D1BatchResult[]> {
	if (statements.length === 0) return [];

	try {
		const rawStatements = statements.map((s) => s.statement);
		const results = await db.batch(rawStatements);

		const DEFAULT_META: D1Meta = {
			changed_db: false,
			changes: 0,
			duration: 0,
			last_row_id: 0,
			rows_read: 0,
			rows_written: 0,
			size_after: 0,
		};

		return results.map((r) => {
			const raw = r as { results?: unknown[]; success?: boolean; meta?: D1Meta };
			return {
				results: raw.results ?? [],
				success: raw.success ?? true,
				meta: raw.meta ?? { ...DEFAULT_META },
			};
		});
	} catch (error) {
		throw new D1BatchError(error instanceof Error ? error.message : String(error), undefined, {
			cause: error,
		});
	}
}
