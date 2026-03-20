import { describe, expect, it } from "vitest";
import {
	detectFormat,
	escapeSqlValue,
	executeSeed,
	generateInsertStatements,
	parseCsvLine,
	parseCsvSeed,
	parseCsvValue,
	parseJsonSeed,
} from "../src/commands/seed";
import { createMockFs } from "./helpers";

describe("seed command", () => {
	describe("detectFormat", () => {
		it("detects CSV format", () => {
			expect(detectFormat("data.csv")).toBe("csv");
		});

		it("defaults to JSON", () => {
			expect(detectFormat("data.json")).toBe("json");
			expect(detectFormat("data.txt")).toBe("json");
		});
	});

	describe("parseJsonSeed", () => {
		it("parses array of objects", () => {
			const records = parseJsonSeed('[{"name":"Alice","age":30}]');
			expect(records).toHaveLength(1);
			expect(records[0]!.name).toBe("Alice");
		});

		it("throws for non-array input", () => {
			expect(() => parseJsonSeed('{"name":"Alice"}')).toThrow("array");
		});

		it("throws for non-object elements", () => {
			expect(() => parseJsonSeed("[1, 2, 3]")).toThrow("plain object");
		});

		it("throws for null elements", () => {
			expect(() => parseJsonSeed("[null]")).toThrow("plain object");
		});

		it("handles empty array", () => {
			expect(parseJsonSeed("[]")).toHaveLength(0);
		});
	});

	describe("parseCsvSeed", () => {
		it("parses CSV with header row", () => {
			const csv = "name,age\nAlice,30\nBob,25";
			const records = parseCsvSeed(csv);
			expect(records).toHaveLength(2);
			expect(records[0]!.name).toBe("Alice");
			expect(records[0]!.age).toBe(30);
		});

		it("throws for header-only CSV", () => {
			expect(() => parseCsvSeed("name,age")).toThrow("at least a header row and one data row");
		});

		it("skips empty lines", () => {
			const csv = "name\nAlice\n\nBob\n";
			const records = parseCsvSeed(csv);
			expect(records).toHaveLength(2);
		});

		it("throws for empty CSV", () => {
			expect(() => parseCsvSeed("")).toThrow();
		});
	});

	describe("parseCsvLine", () => {
		it("splits by comma", () => {
			expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
		});

		it("handles quoted fields with commas", () => {
			expect(parseCsvLine('"hello, world",b')).toEqual(["hello, world", "b"]);
		});

		it("handles escaped quotes", () => {
			expect(parseCsvLine('"he said ""hi""",b')).toEqual(['he said "hi"', "b"]);
		});

		it("trims whitespace", () => {
			expect(parseCsvLine(" a , b ")).toEqual(["a", "b"]);
		});
	});

	describe("parseCsvValue", () => {
		it("parses null", () => {
			expect(parseCsvValue("")).toBeNull();
			expect(parseCsvValue("null")).toBeNull();
			expect(parseCsvValue("NULL")).toBeNull();
		});

		it("parses booleans", () => {
			expect(parseCsvValue("true")).toBe(true);
			expect(parseCsvValue("false")).toBe(false);
			expect(parseCsvValue("TRUE")).toBe(true);
		});

		it("parses numbers", () => {
			expect(parseCsvValue("42")).toBe(42);
			expect(parseCsvValue("3.14")).toBe(3.14);
			expect(parseCsvValue("-1")).toBe(-1);
		});

		it("keeps strings as strings", () => {
			expect(parseCsvValue("hello")).toBe("hello");
		});
	});

	describe("escapeSqlValue", () => {
		it("escapes null", () => {
			expect(escapeSqlValue(null)).toBe("NULL");
		});

		it("escapes booleans", () => {
			expect(escapeSqlValue(true)).toBe("1");
			expect(escapeSqlValue(false)).toBe("0");
		});

		it("escapes numbers", () => {
			expect(escapeSqlValue(42)).toBe("42");
		});

		it("escapes strings with single quotes", () => {
			expect(escapeSqlValue("it's")).toBe("'it''s'");
		});

		it("wraps strings in quotes", () => {
			expect(escapeSqlValue("hello")).toBe("'hello'");
		});
	});

	describe("generateInsertStatements", () => {
		it("generates INSERT statements", () => {
			const records = [
				{ name: "Alice", age: 30 },
				{ name: "Bob", age: 25 },
			];
			const stmts = generateInsertStatements("users", records);
			expect(stmts).toHaveLength(2);
			expect(stmts[0]).toBe("INSERT INTO users (name, age) VALUES ('Alice', 30);");
			expect(stmts[1]).toBe("INSERT INTO users (name, age) VALUES ('Bob', 25);");
		});

		it("handles null values", () => {
			const stmts = generateInsertStatements("t", [{ name: null }]);
			expect(stmts[0]).toContain("NULL");
		});

		it("returns empty for empty records", () => {
			expect(generateInsertStatements("t", [])).toHaveLength(0);
		});

		it("throws for invalid table name", () => {
			expect(() => generateInsertStatements("drop table;--", [{ a: 1 }])).toThrow(
				"Invalid table name",
			);
		});
	});

	describe("executeSeed", () => {
		it("seeds from JSON file", async () => {
			const fs = createMockFs({
				"/seeds/users.json": JSON.stringify([
					{ name: "Alice", age: 30 },
					{ name: "Bob", age: 25 },
				]),
			});
			const result = await executeSeed({ file: "/seeds/users.json", table: "users" }, fs);
			expect(result.records).toBe(2);
			expect(result.statements).toHaveLength(2);
			expect(result.table).toBe("users");
		});

		it("seeds from CSV file", async () => {
			const fs = createMockFs({
				"/seeds/users.csv": "name,age\nAlice,30\nBob,25",
			});
			const result = await executeSeed({ file: "/seeds/users.csv", table: "users" }, fs);
			expect(result.records).toBe(2);
		});

		it("throws for missing file", async () => {
			const fs = createMockFs();
			await expect(executeSeed({ file: "/missing.json", table: "users" }, fs)).rejects.toThrow(
				"not found",
			);
		});

		it("respects explicit format override", async () => {
			const fs = createMockFs({
				"/seeds/data.txt": JSON.stringify([{ x: 1 }]),
			});
			const result = await executeSeed({ file: "/seeds/data.txt", table: "t", format: "json" }, fs);
			expect(result.records).toBe(1);
		});
	});
});
