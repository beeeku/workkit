import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { KVValidationError } from "../src/kv-errors";
import { validateValue } from "../src/validation";

/** Helper: create a sync Standard Schema mock that always passes */
function passingSchema<T>(): StandardSchemaV1<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value: unknown) => ({ value: value as T }),
		},
	};
}

/** Helper: create a sync Standard Schema mock that always fails */
function failingSchema(message = "validation failed"): StandardSchemaV1<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({
				issues: [{ message }],
			}),
		},
	};
}

/** Helper: create an async Standard Schema mock that passes */
function asyncPassingSchema<T>(): StandardSchemaV1<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value: unknown) => Promise.resolve({ value: value as T }),
		},
	};
}

/** Helper: create an async Standard Schema mock that fails */
function asyncFailingSchema(message = "async validation failed"): StandardSchemaV1<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () =>
				Promise.resolve({
					issues: [{ message }],
				}),
		},
	};
}

describe("validateValue", () => {
	it("returns value when validation passes", async () => {
		const schema = passingSchema<{ name: string }>();
		const result = await validateValue(schema, { name: "test" }, "key1");
		expect(result).toEqual({ name: "test" });
	});

	it("throws KVValidationError when validation fails", async () => {
		const schema = failingSchema("bad data");
		await expect(validateValue(schema, "invalid", "key1")).rejects.toThrow(KVValidationError);
	});

	it("handles sync Standard Schema validators", async () => {
		const schema = passingSchema<number>();
		const result = await validateValue(schema, 42, "key1");
		expect(result).toBe(42);
	});

	it("handles async Standard Schema validators", async () => {
		const schema = asyncPassingSchema<string>();
		const result = await validateValue(schema, "hello", "key1");
		expect(result).toBe("hello");
	});

	it("handles async Standard Schema validator failure", async () => {
		const schema = asyncFailingSchema("async bad");
		await expect(validateValue(schema, "bad", "key1")).rejects.toThrow(KVValidationError);
	});

	it("includes key name in error", async () => {
		const schema = failingSchema("fail");
		try {
			await validateValue(schema, null, "my-key");
			expect.fail("Should have thrown");
		} catch (err: any) {
			expect(err.message).toContain("my-key");
			expect(err.kvKey).toBe("my-key");
		}
	});
});
