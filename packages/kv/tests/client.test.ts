import type { StandardSchemaV1 } from "@standard-schema/spec";
import { beforeEach, describe, expect, it } from "vitest";
import { kv } from "../src/client";
import { KVSerializationError, KVValidationError } from "../src/kv-errors";
import { createMockKV } from "./helpers/mock-kv";

type User = { name: string; email: string };

// ─── Construction ─────────────────────────────────────────────────────

describe("kv() construction", () => {
	it("creates a typed KV client from a KVNamespace", () => {
		const mock = createMockKV();
		const store = kv<User>(mock);
		expect(store).toBeDefined();
		expect(typeof store.get).toBe("function");
		expect(typeof store.put).toBe("function");
		expect(typeof store.delete).toBe("function");
		expect(typeof store.exists).toBe("function");
		expect(typeof store.list).toBe("function");
		expect(typeof store.keys).toBe("function");
		expect(typeof store.getMany).toBe("function");
		expect(typeof store.deleteMany).toBe("function");
	});

	it("accepts options with prefix, schema, serializer", () => {
		const mock = createMockKV();
		const schema: StandardSchemaV1<unknown, User> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v) => ({ value: v as User }),
			},
		};
		const store = kv(mock, { prefix: "user:", schema, serializer: "json" });
		expect(store).toBeDefined();
	});

	it("exposes raw KVNamespace via .raw", () => {
		const mock = createMockKV();
		const store = kv<User>(mock);
		expect(store.raw).toBe(mock);
	});
});

// ─── get ──────────────────────────────────────────────────────────────

describe("get", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns deserialized value for existing key", async () => {
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", email: "b@x.com" }),
		});
		const user = await store.get("123");
		expect(user).toEqual({ name: "Bikash", email: "b@x.com" });
	});

	it("returns null for non-existent key", async () => {
		const result = await store.get("nonexistent");
		expect(result).toBeNull();
	});

	it("applies JSON deserialization by default", async () => {
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Test", email: "t@x.com" }),
		});
		const user = await store.get("123");
		expect(user).toEqual({ name: "Test", email: "t@x.com" });
	});

	it("applies text serializer when configured", async () => {
		const textStore = kv<string>(mock, { prefix: "txt:", serializer: "text" });
		mock._store.set("txt:hello", { value: "world" });
		const result = await textStore.get("hello");
		expect(result).toBe("world");
	});

	it("applies custom serializer", async () => {
		const custom = {
			serialize: (v: number) => String(v),
			deserialize: (raw: string) => Number(raw),
		};
		const numStore = kv<number>(mock, { prefix: "num:", serializer: custom });
		mock._store.set("num:x", { value: "42" });
		const result = await numStore.get("x");
		expect(result).toBe(42);
	});

	it("validates value against schema when provided", async () => {
		const schema: StandardSchemaV1<unknown, User> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v) => ({ value: v as User }),
			},
		};
		const validated = kv(mock, { prefix: "user:", schema });
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Ok", email: "ok@x.com" }),
		});
		const result = await validated.get("123");
		expect(result).toEqual({ name: "Ok", email: "ok@x.com" });
	});

	it("throws KVSerializationError on deserialization failure", async () => {
		mock._store.set("user:bad", { value: "not-json{}" });
		await expect(store.get("bad")).rejects.toThrow(KVSerializationError);
	});

	it("throws KVValidationError when value fails schema validation", async () => {
		const schema: StandardSchemaV1<unknown, never> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: () => ({ issues: [{ message: "invalid" }] }),
			},
		};
		const validated = kv(mock, { prefix: "user:", schema });
		mock._store.set("user:123", { value: '{"bad":true}' });
		await expect(validated.get("123")).rejects.toThrow(KVValidationError);
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", {
			value: JSON.stringify({ name: "Alice", email: "a@x.com" }),
		});
		const user = await store.get("abc");
		expect(user?.name).toBe("Alice");
	});
});

// ─── getWithMetadata ──────────────────────────────────────────────────

describe("getWithMetadata", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns value and metadata", async () => {
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", email: "b@x.com" }),
			metadata: { role: "admin" },
		});
		const result = await store.getWithMetadata<{ role: string }>("123");
		expect(result.value).toEqual({ name: "Bikash", email: "b@x.com" });
		expect(result.metadata?.role).toBe("admin");
	});

	it("returns null value with null metadata for missing key", async () => {
		const result = await store.getWithMetadata("nonexistent");
		expect(result.value).toBeNull();
		expect(result.metadata).toBeNull();
	});

	it("applies deserialization and validation", async () => {
		const schema: StandardSchemaV1<unknown, User> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v) => ({ value: v as User }),
			},
		};
		const validated = kv(mock, { prefix: "user:", schema });
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Test", email: "t@x.com" }),
		});
		const result = await validated.getWithMetadata("123");
		expect(result.value).toEqual({ name: "Test", email: "t@x.com" });
	});
});

// ─── put ──────────────────────────────────────────────────────────────

describe("put", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("serializes and stores value", async () => {
		await store.put("123", { name: "Bikash", email: "b@x.com" });
		expect(mock._store.has("user:123")).toBe(true);
		const stored = JSON.parse(mock._store.get("user:123")!.value);
		expect(stored.name).toBe("Bikash");
	});

	it("applies TTL from options", async () => {
		await store.put("123", { name: "Test", email: "t@x.com" }, { ttl: 3600 });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBeDefined();
		expect(entry.expiration!).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3500);
	});

	it("applies absolute expiration from options", async () => {
		const futureTime = Math.floor(Date.now() / 1000) + 86400;
		await store.put("123", { name: "Test", email: "t@x.com" }, { expiration: futureTime });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBe(futureTime);
	});

	it("applies metadata from options", async () => {
		await store.put("123", { name: "Test", email: "t@x.com" }, { metadata: { role: "admin" } });
		const entry = mock._store.get("user:123")!;
		expect(entry.metadata).toEqual({ role: "admin" });
	});

	it("uses defaultTtl when no per-call TTL provided", async () => {
		const storeWithDefault = kv<User>(mock, { prefix: "user:", defaultTtl: 7200 });
		await storeWithDefault.put("123", { name: "Test", email: "t@x.com" });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBeDefined();
	});

	it("prepends prefix to key", async () => {
		await store.put("abc", { name: "Alice", email: "a@x.com" });
		expect(mock._store.has("user:abc")).toBe(true);
		expect(mock._store.has("abc")).toBe(false);
	});

	it("validates value on write when validateOnWrite is true", async () => {
		const schema: StandardSchemaV1<unknown, never> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: () => ({ issues: [{ message: "invalid on write" }] }),
			},
		};
		const validated = kv(mock, { prefix: "user:", schema, validateOnWrite: true });
		await expect(validated.put("123", { name: "bad" } as any)).rejects.toThrow(KVValidationError);
	});

	it("skips validation on write when validateOnWrite is false", async () => {
		const schema: StandardSchemaV1<unknown, never> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: () => ({ issues: [{ message: "invalid" }] }),
			},
		};
		const validated = kv(mock, { prefix: "user:", schema }); // default: validateOnWrite=false
		// Should NOT throw
		await validated.put("123", { name: "anything" } as any);
		expect(mock._store.has("user:123")).toBe(true);
	});

	it("throws KVSerializationError on serialization failure", async () => {
		const badSerializer = {
			serialize: () => {
				throw new Error("can't serialize");
			},
			deserialize: (raw: string) => raw as any,
		};
		const badStore = kv<User>(mock, { prefix: "user:", serializer: badSerializer });
		await expect(badStore.put("123", { name: "test", email: "t@x.com" })).rejects.toThrow(
			KVSerializationError,
		);
	});
});

// ─── delete ───────────────────────────────────────────────────────────

describe("delete", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("deletes a key", async () => {
		mock._store.set("user:123", { value: "{}" });
		await store.delete("123");
		expect(mock._store.has("user:123")).toBe(false);
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: "{}" });
		await store.delete("abc");
		expect(mock._store.has("user:abc")).toBe(false);
	});

	it("does not throw for non-existent key", async () => {
		await expect(store.delete("nonexistent")).resolves.toBeUndefined();
	});
});

// ─── exists ───────────────────────────────────────────────────────────

describe("exists", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns true for existing key", async () => {
		mock._store.set("user:123", { value: "{}" });
		expect(await store.exists("123")).toBe(true);
	});

	it("returns false for non-existent key", async () => {
		expect(await store.exists("nonexistent")).toBe(false);
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: "{}" });
		expect(await store.exists("abc")).toBe(true);
	});
});

// ─── list ─────────────────────────────────────────────────────────────

describe("list", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("yields entries with key and value", async () => {
		await store.put("a", { name: "Alice", email: "a@x.com" });
		await store.put("b", { name: "Bob", email: "b@x.com" });

		const entries = [];
		for await (const entry of store.list()) {
			entries.push(entry);
		}
		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.key).sort()).toEqual(["a", "b"]);
		expect(entries[0]!.value).toBeDefined();
	});

	it("strips prefix from yielded keys", async () => {
		await store.put("abc", { name: "Test", email: "t@x.com" });

		const entries = [];
		for await (const entry of store.list()) {
			entries.push(entry);
		}
		expect(entries[0]!.key).toBe("abc");
		expect(entries[0]!.key).not.toContain("user:");
	});

	it("filters by additional prefix", async () => {
		await store.put("active:1", { name: "A", email: "a@x.com" });
		await store.put("active:2", { name: "B", email: "b@x.com" });
		await store.put("inactive:1", { name: "C", email: "c@x.com" });

		const entries = [];
		for await (const entry of store.list({ prefix: "active:" })) {
			entries.push(entry);
		}
		expect(entries).toHaveLength(2);
	});
});

// ─── keys ─────────────────────────────────────────────────────────────

describe("keys", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("yields key entries without values", async () => {
		await store.put("a", { name: "Alice", email: "a@x.com" });
		await store.put("b", { name: "Bob", email: "b@x.com" });

		const keys = [];
		for await (const entry of store.keys()) {
			keys.push(entry);
		}
		expect(keys).toHaveLength(2);
		expect(keys.map((k) => k.key).sort()).toEqual(["a", "b"]);
		// No value field
		expect((keys[0] as any).value).toBeUndefined();
	});

	it("strips prefix from key entries", async () => {
		await store.put("xyz", { name: "Test", email: "t@x.com" });

		const keys = [];
		for await (const entry of store.keys()) {
			keys.push(entry);
		}
		expect(keys[0]!.key).toBe("xyz");
		expect(keys[0]!.key).not.toContain("user:");
	});
});

// ─── getMany ──────────────────────────────────────────────────────────

describe("getMany", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("fetches multiple keys in parallel", async () => {
		await store.put("a", { name: "Alice", email: "a@x.com" });
		await store.put("b", { name: "Bob", email: "b@x.com" });

		const results = await store.getMany(["a", "b"]);
		expect(results.size).toBe(2);
		expect(results.get("a")).toEqual({ name: "Alice", email: "a@x.com" });
	});

	it("returns Map with null for missing keys", async () => {
		await store.put("a", { name: "Alice", email: "a@x.com" });

		const results = await store.getMany(["a", "missing"]);
		// Missing key is present in the map with a null value
		expect(results.has("missing")).toBe(true);
		expect(results.get("missing")).toBeNull();
	});

	it("applies prefix to all keys", async () => {
		await store.put("abc", { name: "Test", email: "t@x.com" });

		const results = await store.getMany(["abc"]);
		expect(results.has("abc")).toBe(true);
		expect(results.has("user:abc")).toBe(false);
	});
});

// ─── deleteMany ───────────────────────────────────────────────────────

describe("deleteMany", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("deletes multiple keys in parallel", async () => {
		await store.put("a", { name: "Alice", email: "a@x.com" });
		await store.put("b", { name: "Bob", email: "b@x.com" });
		await store.deleteMany(["a", "b"]);
		expect(mock._store.has("user:a")).toBe(false);
		expect(mock._store.has("user:b")).toBe(false);
	});

	it("applies prefix to all keys", async () => {
		mock._store.set("user:x", { value: "{}" });
		await store.deleteMany(["x"]);
		expect(mock._store.has("user:x")).toBe(false);
	});
});
