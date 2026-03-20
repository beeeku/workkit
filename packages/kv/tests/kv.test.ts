import { BindingNotFoundError, ConfigError, ValidationError } from "@workkit/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { kv } from "../src/kv";
import { createMockKV } from "./helpers/mock-kv";

type User = { name: string; email: string };

describe("kv() factory", () => {
	it("throws BindingNotFoundError for null binding", () => {
		expect(() => kv<User>(null as any)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for undefined binding", () => {
		expect(() => kv<User>(undefined as any)).toThrow(BindingNotFoundError);
	});

	it("throws ConfigError for non-KVNamespace object", () => {
		expect(() => kv<User>({ foo: "bar" } as any)).toThrow(ConfigError);
	});

	it("creates a WorkkitKV instance with default options", () => {
		const mock = createMockKV();
		const store = kv<User>(mock);
		expect(store).toBeDefined();
		expect(typeof store.get).toBe("function");
		expect(typeof store.put).toBe("function");
		expect(typeof store.delete).toBe("function");
	});

	it("exposes .raw as the original KVNamespace binding", () => {
		const mock = createMockKV();
		const store = kv<User>(mock);
		expect(store.raw).toBe(mock);
	});
});

describe("get()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns typed value for existing key", async () => {
		mock._store.set("user:123", { value: JSON.stringify({ name: "Bikash", email: "b@x.com" }) });
		const user = await store.get("123");
		expect(user).toEqual({ name: "Bikash", email: "b@x.com" });
	});

	it("returns null for missing key", async () => {
		const result = await store.get("nonexistent");
		expect(result).toBeNull();
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: JSON.stringify({ name: "Alice", email: "a@x.com" }) });
		const user = await store.get("abc");
		expect(user?.name).toBe("Alice");
	});
});

describe("put()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("stores a typed value", async () => {
		await store.put("123", { name: "Bikash", email: "b@x.com" });
		expect(mock._store.has("user:123")).toBe(true);
		const stored = JSON.parse(mock._store.get("user:123")!.value);
		expect(stored.name).toBe("Bikash");
	});

	it("prepends prefix to key", async () => {
		await store.put("abc", { name: "Alice", email: "a@x.com" });
		expect(mock._store.has("user:abc")).toBe(true);
		expect(mock._store.has("abc")).toBe(false);
	});

	it("passes expirationTtl from ttl option", async () => {
		await store.put("123", { name: "Test", email: "t@x.com" }, { ttl: 3600 });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBeDefined();
		// Should be roughly now + 3600 seconds
		expect(entry.expiration!).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3500);
	});

	it("passes expiration from expiration option", async () => {
		const futureTime = Math.floor(Date.now() / 1000) + 86400;
		await store.put("123", { name: "Test", email: "t@x.com" }, { expiration: futureTime });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBe(futureTime);
	});

	it("uses defaultTtl when no per-call ttl", async () => {
		const storeWithDefault = kv<User>(mock, { prefix: "user:", defaultTtl: 7200 });
		await storeWithDefault.put("123", { name: "Test", email: "t@x.com" });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBeDefined();
	});

	it("expiration takes precedence over ttl", async () => {
		const expTime = Math.floor(Date.now() / 1000) + 999;
		await store.put("123", { name: "Test", email: "t@x.com" }, { ttl: 3600, expiration: expTime });
		const entry = mock._store.get("user:123")!;
		expect(entry.expiration).toBe(expTime);
	});

	it("passes metadata to underlying KV", async () => {
		await store.put("123", { name: "Test", email: "t@x.com" }, { metadata: { role: "admin" } });
		const entry = mock._store.get("user:123")!;
		expect(entry.metadata).toEqual({ role: "admin" });
	});

	it("validates TTL >= 60 seconds", async () => {
		await expect(store.put("123", { name: "Test", email: "t@x.com" }, { ttl: 30 })).rejects.toThrow(
			ValidationError,
		);
	});
});

describe("delete()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("deletes an existing key", async () => {
		mock._store.set("user:123", { value: "{}" });
		await store.delete("123");
		expect(mock._store.has("user:123")).toBe(false);
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: "{}" });
		await store.delete("abc");
		expect(mock._store.has("user:abc")).toBe(false);
	});

	it("does not throw for missing key (idempotent)", async () => {
		await expect(store.delete("nonexistent")).resolves.toBeUndefined();
	});
});

describe("getWithMetadata()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns value and metadata for existing key", async () => {
		mock._store.set("user:123", {
			value: JSON.stringify({ name: "Bikash", email: "b@x.com" }),
			metadata: { role: "admin" },
		});
		const result = await store.getWithMetadata<{ role: string }>("123");
		expect(result.value).toEqual({ name: "Bikash", email: "b@x.com" });
		expect(result.metadata?.role).toBe("admin");
	});

	it("returns null value and null metadata for missing key", async () => {
		const result = await store.getWithMetadata("nonexistent");
		expect(result.value).toBeNull();
		expect(result.metadata).toBeNull();
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: JSON.stringify({ name: "Test", email: "t@x.com" }) });
		const result = await store.getWithMetadata("abc");
		expect(result.value).toBeDefined();
	});
});

describe("has()", () => {
	let mock: ReturnType<typeof createMockKV>;
	let store: ReturnType<typeof kv<User>>;

	beforeEach(() => {
		mock = createMockKV();
		store = kv<User>(mock, { prefix: "user:" });
	});

	it("returns true for existing key", async () => {
		mock._store.set("user:123", { value: "{}" });
		expect(await store.has("123")).toBe(true);
	});

	it("returns false for missing key", async () => {
		expect(await store.has("nonexistent")).toBe(false);
	});

	it("prepends prefix to key", async () => {
		mock._store.set("user:abc", { value: "{}" });
		expect(await store.has("abc")).toBe(true);
	});
});

describe("no prefix", () => {
	it("works without prefix", async () => {
		const mock = createMockKV();
		const store = kv<string>(mock, { serializer: "text" });
		await store.put("key", "value");
		expect(mock._store.has("key")).toBe(true);
		const result = await store.get("key");
		expect(result).toBe("value");
	});
});
