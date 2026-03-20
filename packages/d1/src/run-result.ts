import type { D1Meta, D1RunResult } from "./types";

const DEFAULT_META: D1Meta = {
	changed_db: false,
	changes: 0,
	duration: 0,
	last_row_id: 0,
	rows_read: 0,
	rows_written: 0,
	size_after: 0,
};

interface RawRunResult {
	success?: boolean;
	meta?: D1Meta;
}

/**
 * Extract a typed D1RunResult from the raw D1 response.
 * Centralizes the `as any` cast so it only appears once.
 */
export function extractRunResult(result: unknown): D1RunResult {
	const r = result as RawRunResult;
	return {
		success: r.success ?? true,
		meta: r.meta ?? { ...DEFAULT_META },
	};
}
