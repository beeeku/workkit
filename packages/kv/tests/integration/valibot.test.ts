import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { kv } from "../../src/client";
import { KVValidationError } from "../../src/kv-errors";
import { createMockKV } from "../helpers/mock-kv";

describe("kv with Valibot schema", () => {
	it("validates values on get with Valibot pipe", async () => {
		const mock = createMockKV();
		const schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) });
		const store = kv(mock, { prefix: "user:", schema });

		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", email: "b@example.com" }),
		});

		const result = await store.get("123");
		expect(result).toEqual({ name: "Bikash", email: "b@example.com" });
	});

	it("rejects invalid values", async () => {
		const mock = createMockKV();
		const schema = v.object({ name: v.string(), email: v.pipe(v.string(), v.email()) });
		const store = kv(mock, { prefix: "user:", schema });

		// Store data with invalid email
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", email: "not-an-email" }),
		});

		await expect(store.get("123")).rejects.toThrow(KVValidationError);
	});

	it("validates on put when validateOnWrite is true", async () => {
		const mock = createMockKV();
		const schema = v.object({ name: v.string(), count: v.number() });
		const store = kv(mock, { prefix: "item:", schema, validateOnWrite: true });

		// Valid put
		await store.put("a", { name: "test", count: 1 });
		expect(mock._store.has("item:a")).toBe(true);

		// Invalid put
		await expect(store.put("b", { name: "bad", count: "not-a-number" } as any)).rejects.toThrow(
			KVValidationError,
		);
	});
});
