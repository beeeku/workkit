import { describe, expect, it } from "vitest";
import { snakeToCamel, transformResults, transformRow } from "../src/result";

describe("snakeToCamel", () => {
	it("converts snake_case to camelCase", () => {
		expect(snakeToCamel("created_at")).toBe("createdAt");
		expect(snakeToCamel("first_name")).toBe("firstName");
		expect(snakeToCamel("user_profile_image_url")).toBe("userProfileImageUrl");
	});

	it("leaves already camelCase strings unchanged", () => {
		expect(snakeToCamel("createdAt")).toBe("createdAt");
		expect(snakeToCamel("name")).toBe("name");
	});

	it("handles single word", () => {
		expect(snakeToCamel("id")).toBe("id");
	});

	it("handles empty string", () => {
		expect(snakeToCamel("")).toBe("");
	});

	it("handles multiple underscores", () => {
		expect(snakeToCamel("is_email_verified")).toBe("isEmailVerified");
	});
});

describe("transformRow", () => {
	it("returns row unchanged when no transformer", () => {
		const row = { id: 1, name: "Bikash" };
		expect(transformRow(row)).toBe(row);
	});

	it("applies transformer to all column names", () => {
		const row = { created_at: "2024-01-01", first_name: "Bikash" };
		const result = transformRow(row, snakeToCamel);
		expect(result).toEqual({ createdAt: "2024-01-01", firstName: "Bikash" });
	});

	it("preserves values including null", () => {
		const row = { deleted_at: null, is_active: true, score: 0 };
		const result = transformRow(row, snakeToCamel);
		expect(result).toEqual({ deletedAt: null, isActive: true, score: 0 });
	});

	it("works with custom transformer", () => {
		const upper = (col: string) => col.toUpperCase();
		const row = { id: 1, name: "test" };
		const result = transformRow(row, upper);
		expect(result).toEqual({ ID: 1, NAME: "test" });
	});
});

describe("transformResults", () => {
	it("returns results unchanged when no transformer", () => {
		const rows = [{ id: 1 }, { id: 2 }];
		expect(transformResults(rows)).toBe(rows);
	});

	it("applies transformer to all rows", () => {
		const rows = [
			{ first_name: "Alice", last_name: "A" },
			{ first_name: "Bob", last_name: "B" },
		];
		const result = transformResults(rows, snakeToCamel);
		expect(result).toEqual([
			{ firstName: "Alice", lastName: "A" },
			{ firstName: "Bob", lastName: "B" },
		]);
	});

	it("handles empty array", () => {
		expect(transformResults([], snakeToCamel)).toEqual([]);
	});
});
