import { describe, expect, it } from "vitest";
import { extractRunResult } from "../src/run-result";

describe("extractRunResult", () => {
	it("extracts success and meta from a valid result", () => {
		const raw = {
			success: true,
			meta: {
				changed_db: true,
				changes: 5,
				duration: 1.2,
				last_row_id: 42,
				rows_read: 0,
				rows_written: 5,
				size_after: 1024,
			},
		};
		const result = extractRunResult(raw);
		expect(result.success).toBe(true);
		expect(result.meta.changes).toBe(5);
		expect(result.meta.last_row_id).toBe(42);
		expect(result.meta.changed_db).toBe(true);
	});

	it("defaults success to true when missing", () => {
		const result = extractRunResult({});
		expect(result.success).toBe(true);
	});

	it("defaults meta to all-zeros when missing", () => {
		const result = extractRunResult({});
		expect(result.meta).toEqual({
			changed_db: false,
			changes: 0,
			duration: 0,
			last_row_id: 0,
			rows_read: 0,
			rows_written: 0,
			size_after: 0,
		});
	});

	it("preserves explicit false success", () => {
		const result = extractRunResult({ success: false });
		expect(result.success).toBe(false);
	});

	it("throws on null input (no null-safety)", () => {
		expect(() => extractRunResult(null)).toThrow();
	});

	it("throws on undefined input (no null-safety)", () => {
		expect(() => extractRunResult(undefined)).toThrow();
	});

	it("uses provided meta and does not mutate DEFAULT_META", () => {
		const r1 = extractRunResult({});
		const r2 = extractRunResult({});
		// Mutating r1's meta should not affect r2's meta (separate objects)
		r1.meta.changes = 999;
		expect(r2.meta.changes).toBe(0);
	});

	it("handles result with extra fields", () => {
		const raw = {
			success: true,
			meta: {
				changed_db: true,
				changes: 1,
				duration: 0.5,
				last_row_id: 1,
				rows_read: 0,
				rows_written: 1,
				size_after: 512,
			},
			results: [{ id: 1 }], // extra field from D1
		};
		const result = extractRunResult(raw);
		expect(result.success).toBe(true);
		expect(result.meta.changes).toBe(1);
	});
});
