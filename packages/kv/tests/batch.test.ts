import { beforeEach, describe, expect, it } from "vitest";
import { kv } from "../src/kv";
import { createMockKV } from "./helpers/mock-kv";

type User = { name: string };

describe("getMany()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns Map of existing keys", async () => {
		await store.put("a", { name: "Alice" });
		await store.put("b", { name: "Bob" });

		const results = await store.getMany(["a", "b"]);
		expect(results.size).toBe(2);
		expect(results.get("a")).toEqual({ name: "Alice" });
		expect(results.get("b")).toEqual({ name: "Bob" });
	});

	it("omits missing keys from result", async () => {
		await store.put("a", { name: "Alice" });

		const results = await store.getMany(["a", "missing"]);
		expect(results.size).toBe(1);
		expect(results.has("missing")).toBe(false);
	});

	it("strips prefix from result map keys", async () => {
		await store.put("abc", { name: "Test" });

		const results = await store.getMany(["abc"]);
		expect(results.has("abc")).toBe(true);
		expect(results.has("user:abc")).toBe(false);
	});

	it("handles empty key array", async () => {
		const results = await store.getMany([]);
		expect(results.size).toBe(0);
	});
});

describe("putMany()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("stores all entries", async () => {
		await store.putMany([
			{ key: "a", value: { name: "Alice" } },
			{ key: "b", value: { name: "Bob" } },
		]);
		expect(mock._store.has("user:a")).toBe(true);
		expect(mock._store.has("user:b")).toBe(true);
	});

	it("prepends prefix to all keys", async () => {
		await store.putMany([{ key: "x", value: { name: "X" } }]);
		expect(mock._store.has("user:x")).toBe(true);
		expect(mock._store.has("x")).toBe(false);
	});

	it("respects per-entry options", async () => {
		await store.putMany([
			{ key: "a", value: { name: "Alice" }, options: { metadata: { role: "admin" } } },
		]);
		const entry = mock._store.get("user:a")!;
		expect(entry.metadata).toEqual({ role: "admin" });
	});

	it("handles empty entry array", async () => {
		await expect(store.putMany([])).resolves.toBeUndefined();
	});
});

describe("deleteMany()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("deletes all specified keys", async () => {
		await store.put("a", { name: "Alice" });
		await store.put("b", { name: "Bob" });
		await store.deleteMany(["a", "b"]);
		expect(mock._store.has("user:a")).toBe(false);
		expect(mock._store.has("user:b")).toBe(false);
	});

	it("prepends prefix to all keys", async () => {
		mock._store.set("user:x", { value: "{}" });
		await store.deleteMany(["x"]);
		expect(mock._store.has("user:x")).toBe(false);
	});

	it("handles empty key array", async () => {
		await expect(store.deleteMany([])).resolves.toBeUndefined();
	});

	it("does not throw for missing keys", async () => {
		await expect(store.deleteMany(["nonexistent"])).resolves.toBeUndefined();
	});
});
