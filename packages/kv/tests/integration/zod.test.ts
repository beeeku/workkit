import { describe, expect, it } from "vitest";
import { z } from "zod";
import { kv } from "../../src/client";
import { KVValidationError } from "../../src/kv-errors";
import { createMockKV } from "../helpers/mock-kv";

describe("kv with Zod schema", () => {
	it("validates values on get", async () => {
		const mock = createMockKV();
		const schema = z.object({ name: z.string(), age: z.number() });
		const store = kv(mock, { prefix: "user:", schema });

		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", age: 30 }),
		});

		const result = await store.get("123");
		expect(result).toEqual({ name: "Bikash", age: 30 });
	});

	it("rejects invalid values with KVValidationError", async () => {
		const mock = createMockKV();
		const schema = z.object({ name: z.string(), age: z.number() });
		const store = kv(mock, { prefix: "user:", schema });

		// Store invalid data (age is string instead of number)
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", age: "not-a-number" }),
		});

		await expect(store.get("123")).rejects.toThrow(KVValidationError);
	});

	it("validates on put when validateOnWrite is true", async () => {
		const mock = createMockKV();
		const schema = z.object({ name: z.string(), age: z.number() });
		const store = kv(mock, { prefix: "user:", schema, validateOnWrite: true });

		// Valid put should work
		await store.put("123", { name: "Bikash", age: 30 });
		expect(mock._store.has("user:123")).toBe(true);

		// Invalid put should throw
		await expect(store.put("456", { name: "Bad", age: "not-a-number" } as any)).rejects.toThrow(
			KVValidationError,
		);
	});

	it("skips validation on put by default", async () => {
		const mock = createMockKV();
		const schema = z.object({ name: z.string(), age: z.number() });
		const store = kv(mock, { prefix: "user:", schema });

		// Invalid data should be written without validation
		await store.put("123", { name: "Bad", age: "not-a-number" } as any);
		expect(mock._store.has("user:123")).toBe(true);
	});

	it("infers type from Zod schema", async () => {
		const mock = createMockKV();
		const schema = z.object({ name: z.string() });
		const store = kv(mock, { prefix: "user:", schema });

		mock._store.set("user:1", { value: JSON.stringify({ name: "Test" }) });
		const result = await store.get("1");
		// Type should be { name: string } | null — runtime check
		if (result) {
			expect(result.name).toBe("Test");
		}
	});
});
