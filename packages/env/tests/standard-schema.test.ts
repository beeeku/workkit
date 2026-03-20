import { describe, expect, it } from "vitest";
import { isStandardSchema, validateValue, validateValueSync } from "../src/standard-schema";

describe("isStandardSchema", () => {
	it("returns true for valid Standard Schema objects", () => {
		const schema = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: () => ({ value: "ok" }),
			},
		};
		expect(isStandardSchema(schema)).toBe(true);
	});

	it("returns false for null", () => {
		expect(isStandardSchema(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isStandardSchema(undefined)).toBe(false);
	});

	it("returns false for primitives", () => {
		expect(isStandardSchema("string")).toBe(false);
		expect(isStandardSchema(42)).toBe(false);
		expect(isStandardSchema(true)).toBe(false);
	});

	it("returns false for objects without ~standard", () => {
		expect(isStandardSchema({ foo: "bar" })).toBe(false);
	});

	it("returns false for objects with ~standard but no validate", () => {
		expect(isStandardSchema({ "~standard": { version: 1 } })).toBe(false);
	});

	it("returns false for objects with ~standard as non-object", () => {
		expect(isStandardSchema({ "~standard": "not-an-object" })).toBe(false);
	});
});

describe("validateValue", () => {
	it("validates sync schema", async () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (v: unknown) => ({ value: v }),
			},
		};
		const result = await validateValue(schema, "hello");
		expect(result).toEqual({ value: "hello" });
	});

	it("validates async schema", async () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (v: unknown) => Promise.resolve({ value: v }),
			},
		};
		const result = await validateValue(schema, "hello");
		expect(result).toEqual({ value: "hello" });
	});
});

describe("validateValueSync", () => {
	it("validates sync schema", () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (v: unknown) => ({ value: v }),
			},
		};
		const result = validateValueSync(schema, "hello");
		expect(result).toEqual({ value: "hello" });
	});

	it("throws if schema returns Promise", () => {
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (v: unknown) => Promise.resolve({ value: v }),
			},
		};
		expect(() => validateValueSync(schema, "hello")).toThrow(/Promise/);
	});
});
