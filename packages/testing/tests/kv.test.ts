import { beforeEach, describe, expect, it } from "vitest";
import { createMockKV } from "../src/kv";

describe("createMockKV", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
	});

	it("returns a KV mock with internal store", () => {
		expect(kv._store).toBeInstanceOf(Map);
	});

	describe("get", () => {
		it("returns null for missing keys", async () => {
			expect(await kv.get("missing")).toBeNull();
		});

		it("returns text by default", async () => {
			await kv.put("key", "hello");
			expect(await kv.get("key")).toBe("hello");
		});

		it('returns text when type is "text"', async () => {
			await kv.put("key", "hello");
			expect(await kv.get("key", "text")).toBe("hello");
		});

		it('returns parsed JSON when type is "json"', async () => {
			await kv.put("key", JSON.stringify({ a: 1 }));
			expect(await kv.get("key", "json")).toEqual({ a: 1 });
		});

		it("returns parsed JSON with options object", async () => {
			await kv.put("key", JSON.stringify({ a: 1 }));
			expect(await kv.get("key", { type: "json" })).toEqual({ a: 1 });
		});

		it("returns null for expired keys", async () => {
			await kv.put("key", "val", { expirationTtl: -1 });
			// Force expiration by setting past timestamp
			kv._store.get("key")!.expiration = Math.floor(Date.now() / 1000) - 10;
			expect(await kv.get("key")).toBeNull();
		});

		it("cleans up expired keys from store on get", async () => {
			await kv.put("key", "val");
			kv._store.get("key")!.expiration = Math.floor(Date.now() / 1000) - 10;
			await kv.get("key");
			expect(kv._store.has("key")).toBe(false);
		});
	});

	describe("getWithMetadata", () => {
		it("returns null value and metadata for missing keys", async () => {
			const result = await kv.getWithMetadata("missing");
			expect(result.value).toBeNull();
			expect(result.metadata).toBeNull();
		});

		it("returns value and metadata", async () => {
			await kv.put("key", "hello", { metadata: { tag: "x" } });
			const result = await kv.getWithMetadata("key");
			expect(result.value).toBe("hello");
			expect(result.metadata).toEqual({ tag: "x" });
		});

		it("returns JSON parsed value", async () => {
			await kv.put("key", JSON.stringify({ a: 1 }), { metadata: { v: 1 } });
			const result = await kv.getWithMetadata("key", "json");
			expect(result.value).toEqual({ a: 1 });
		});

		it("returns null for expired entries", async () => {
			await kv.put("key", "val", { metadata: { x: 1 } });
			kv._store.get("key")!.expiration = Math.floor(Date.now() / 1000) - 10;
			const result = await kv.getWithMetadata("key");
			expect(result.value).toBeNull();
			expect(result.metadata).toBeNull();
		});
	});

	describe("put", () => {
		it("stores a string value", async () => {
			await kv.put("key", "value");
			expect(await kv.get("key")).toBe("value");
		});

		it("stores a non-string value as JSON", async () => {
			await kv.put("key", { a: 1 });
			const raw = kv._store.get("key")!.value;
			expect(raw).toBe('{"a":1}');
		});

		it("stores expiration from absolute timestamp", async () => {
			const exp = Math.floor(Date.now() / 1000) + 3600;
			await kv.put("key", "val", { expiration: exp });
			expect(kv._store.get("key")!.expiration).toBe(exp);
		});

		it("stores expiration from TTL", async () => {
			const before = Math.floor(Date.now() / 1000);
			await kv.put("key", "val", { expirationTtl: 60 });
			const stored = kv._store.get("key")!.expiration!;
			expect(stored).toBeGreaterThanOrEqual(before + 60);
			expect(stored).toBeLessThanOrEqual(before + 61);
		});

		it("stores metadata", async () => {
			await kv.put("key", "val", { metadata: { version: 2 } });
			expect(kv._store.get("key")!.metadata).toEqual({ version: 2 });
		});
	});

	describe("delete", () => {
		it("removes existing keys", async () => {
			await kv.put("key", "val");
			await kv.delete("key");
			expect(await kv.get("key")).toBeNull();
		});

		it("is a no-op for missing keys", async () => {
			await expect(kv.delete("missing")).resolves.toBeUndefined();
		});
	});

	describe("list", () => {
		beforeEach(async () => {
			await kv.put("users:1", "a");
			await kv.put("users:2", "b");
			await kv.put("users:3", "c");
			await kv.put("posts:1", "x");
		});

		it("lists all keys without options", async () => {
			const result = await kv.list();
			expect(result.keys).toHaveLength(4);
			expect(result.list_complete).toBe(true);
		});

		it("filters by prefix", async () => {
			const result = await kv.list({ prefix: "users:" });
			expect(result.keys).toHaveLength(3);
			expect(result.keys.every((k: any) => k.name.startsWith("users:"))).toBe(true);
		});

		it("limits results", async () => {
			const result = await kv.list({ limit: 2 });
			expect(result.keys).toHaveLength(2);
			expect(result.list_complete).toBe(false);
			expect(result.cursor).toBeDefined();
		});

		it("paginates with cursor", async () => {
			const page1 = await kv.list({ limit: 2 });
			const page2 = await kv.list({ limit: 2, cursor: page1.cursor });
			expect(page2.keys).toHaveLength(2);
			expect(page2.list_complete).toBe(true);
		});

		it("returns keys sorted alphabetically", async () => {
			const result = await kv.list();
			const names = result.keys.map((k: any) => k.name);
			expect(names).toEqual([...names].sort());
		});

		it("includes expiration and metadata in key info", async () => {
			const exp = Math.floor(Date.now() / 1000) + 3600;
			await kv.put("meta:1", "val", { expiration: exp, metadata: { v: 1 } });
			const result = await kv.list({ prefix: "meta:" });
			expect(result.keys[0].expiration).toBe(exp);
			expect(result.keys[0].metadata).toEqual({ v: 1 });
		});
	});
});
