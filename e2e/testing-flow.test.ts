import { describe, expect, it } from "vitest";
import {
	createExecutionContext,
	createMockD1,
	createMockKV,
	createRequest,
	createTestEnv,
} from "./helpers/setup";

describe("Testing utilities E2E", () => {
	describe("createTestEnv", () => {
		it("creates all binding types", () => {
			const env = createTestEnv({
				kv: ["CACHE", "SESSIONS"] as const,
				d1: ["DB"] as const,
				r2: ["BUCKET"] as const,
				queue: ["TASKS"] as const,
				vars: { API_URL: "https://api.example.com", DEBUG: true, PORT: 3000 },
			});

			expect(env.CACHE).toBeDefined();
			expect(env.SESSIONS).toBeDefined();
			expect(env.DB).toBeDefined();
			expect(env.BUCKET).toBeDefined();
			expect(env.TASKS).toBeDefined();
			expect(env.API_URL).toBe("https://api.example.com");
			expect(env.DEBUG).toBe(true);
			expect(env.PORT).toBe(3000);
		});

		it("creates independent binding instances", async () => {
			const env = createTestEnv({
				kv: ["CACHE_A", "CACHE_B"] as const,
			});

			await env.CACHE_A.put("key", "value-a");
			await env.CACHE_B.put("key", "value-b");

			const a = await env.CACHE_A.get("key");
			const b = await env.CACHE_B.get("key");
			expect(a).toBe("value-a");
			expect(b).toBe("value-b");
		});

		it("works with empty config", () => {
			const env = createTestEnv({});
			expect(env).toBeDefined();
		});

		it("handles vars-only config", () => {
			const env = createTestEnv({ vars: { KEY: "value" } });
			expect(env.KEY).toBe("value");
		});
	});

	describe("Mock KV behaves like real KV", () => {
		it("get returns null for missing keys", async () => {
			const kv = createMockKV();
			const result = await kv.get("nonexistent");
			expect(result).toBeNull();
		});

		it("put and get roundtrip (text)", async () => {
			const kv = createMockKV();
			await kv.put("name", "Alice");
			const result = await kv.get("name");
			expect(result).toBe("Alice");
		});

		it("put and get roundtrip (json)", async () => {
			const kv = createMockKV();
			const data = { name: "Alice", age: 30 };
			await kv.put("user", JSON.stringify(data));
			const result = await kv.get("user", "json");
			expect(result).toEqual(data);
		});

		it("delete removes entries", async () => {
			const kv = createMockKV();
			await kv.put("key", "value");
			expect(await kv.get("key")).toBe("value");

			await kv.delete("key");
			expect(await kv.get("key")).toBeNull();
		});

		it("list returns all keys", async () => {
			const kv = createMockKV();
			await kv.put("a", "1");
			await kv.put("b", "2");
			await kv.put("c", "3");

			const result = await kv.list();
			expect(result.keys).toHaveLength(3);
			expect(result.list_complete).toBe(true);
		});

		it("list with prefix filters keys", async () => {
			const kv = createMockKV();
			await kv.put("user:1", "Alice");
			await kv.put("user:2", "Bob");
			await kv.put("post:1", "Hello");

			const result = await kv.list({ prefix: "user:" });
			expect(result.keys).toHaveLength(2);
			expect(result.keys.map((k: any) => k.name)).toEqual(["user:1", "user:2"]);
		});

		it("list with limit and cursor pagination", async () => {
			const kv = createMockKV();
			for (let i = 0; i < 5; i++) {
				await kv.put(`key${i}`, `value${i}`);
			}

			const page1 = await kv.list({ limit: 2 });
			expect(page1.keys).toHaveLength(2);
			expect(page1.list_complete).toBe(false);
			expect(page1.cursor).toBeDefined();

			const page2 = await kv.list({ limit: 2, cursor: page1.cursor });
			expect(page2.keys).toHaveLength(2);
			expect(page2.list_complete).toBe(false);

			const page3 = await kv.list({ limit: 2, cursor: page2.cursor });
			expect(page3.keys).toHaveLength(1);
			expect(page3.list_complete).toBe(true);
		});

		it("put with metadata and getWithMetadata", async () => {
			const kv = createMockKV();
			await kv.put("key", "value", { metadata: { source: "test" } });

			const result = await kv.getWithMetadata("key");
			expect(result.value).toBe("value");
			expect(result.metadata).toEqual({ source: "test" });
		});

		it("put with expirationTtl", async () => {
			const kv = createMockKV();
			// Set a very short TTL (already expired)
			await kv.put("temp", "data", { expirationTtl: -1 });
			// The key should be expired
			const result = await kv.get("temp");
			expect(result).toBeNull();
		});

		it("overwriting a key updates the value", async () => {
			const kv = createMockKV();
			await kv.put("key", "old");
			await kv.put("key", "new");
			expect(await kv.get("key")).toBe("new");
		});

		it("get with json type option object", async () => {
			const kv = createMockKV();
			await kv.put("data", JSON.stringify({ x: 1 }));
			const result = await kv.get("data", { type: "json" });
			expect(result).toEqual({ x: 1 });
		});
	});

	describe("Mock D1 behaves like real D1", () => {
		it("create table and insert", async () => {
			const db = createMockD1();
			await db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
			const stmt = db.prepare("INSERT INTO items (name) VALUES (?)").bind("Test");
			const result = await stmt.run();
			expect(result.success).toBe(true);
		});

		it("prepare/bind/first returns a row", async () => {
			const db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
			const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first();
			expect(user).toEqual({ id: 1, name: "Alice" });
		});

		it("prepare/bind/all returns multiple rows", async () => {
			const db = createMockD1({
				users: [
					{ id: 1, name: "Alice", active: 1 },
					{ id: 2, name: "Bob", active: 1 },
					{ id: 3, name: "Charlie", active: 0 },
				],
			});

			const result = await db.prepare("SELECT * FROM users WHERE active = ?").bind(1).all();

			expect(result.results).toHaveLength(2);
			expect(result.success).toBe(true);
		});

		it("first returns null for no results", async () => {
			const db = createMockD1({ users: [] });
			const result = await db.prepare("SELECT * FROM users WHERE id = ?").bind(999).first();
			expect(result).toBeNull();
		});

		it("UPDATE modifies rows", async () => {
			const db = createMockD1({ users: [{ id: 1, name: "Alice", email: "old@test.com" }] });

			await db.prepare("UPDATE users SET email = ? WHERE id = ?").bind("new@test.com", 1).run();

			const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first();
			expect((user as any).email).toBe("new@test.com");
		});

		it("DELETE removes rows", async () => {
			const db = createMockD1({
				users: [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				],
			});

			await db.prepare("DELETE FROM users WHERE id = ?").bind(1).run();

			const result = await db.prepare("SELECT * FROM users").all();
			expect(result.results).toHaveLength(1);
			expect((result.results[0] as any).name).toBe("Bob");
		});

		it("batch executes multiple statements", async () => {
			const db = createMockD1();
			await db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");

			const results = await db.batch([
				db.prepare("INSERT INTO items (name) VALUES (?)").bind("A"),
				db.prepare("INSERT INTO items (name) VALUES (?)").bind("B"),
				db.prepare("INSERT INTO items (name) VALUES (?)").bind("C"),
			]);

			expect(results).toHaveLength(3);

			const all = await db.prepare("SELECT * FROM items").all();
			expect(all.results).toHaveLength(3);
		});

		it("exec runs multiple statements separated by semicolons", async () => {
			const db = createMockD1();
			const result = await db.exec("CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER)");
			expect(result.count).toBe(2);
		});

		it("raw returns arrays of values", async () => {
			const db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
			const raw = await db.prepare("SELECT * FROM users").raw();
			expect(raw).toHaveLength(1);
			expect(Array.isArray(raw[0])).toBe(true);
		});

		it("first with column name returns single value", async () => {
			const db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
			const name = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first("name");
			expect(name).toBe("Alice");
		});

		it("throws for queries against non-existent tables", async () => {
			const db = createMockD1();
			await expect(db.prepare("SELECT * FROM nonexistent").all()).rejects.toThrow("no such table");
		});
	});

	describe("createRequest creates valid Request objects", () => {
		it("creates a GET request by default", () => {
			const req = createRequest("/api/users");
			expect(req.method).toBe("GET");
			expect(new URL(req.url).pathname).toBe("/api/users");
		});

		it("creates POST request with JSON body", async () => {
			const req = createRequest("/api/users", {
				method: "POST",
				body: { name: "Alice" },
			});

			expect(req.method).toBe("POST");
			expect(req.headers.get("Content-Type")).toBe("application/json");

			const body = await req.json();
			expect(body).toEqual({ name: "Alice" });
		});

		it("creates request with custom headers", () => {
			const req = createRequest("/api/users", {
				headers: { Authorization: "Bearer token123" },
			});

			expect(req.headers.get("Authorization")).toBe("Bearer token123");
		});

		it("handles full URLs", () => {
			const req = createRequest("https://api.example.com/users");
			expect(req.url).toBe("https://api.example.com/users");
		});

		it("normalizes paths without leading slash", () => {
			const req = createRequest("api/users");
			expect(new URL(req.url).pathname).toBe("/api/users");
		});

		it("creates request with string body", async () => {
			const req = createRequest("/api/text", {
				method: "POST",
				body: "plain text content",
			});

			const body = await req.text();
			expect(body).toBe("plain text content");
		});

		it("creates DELETE request", () => {
			const req = createRequest("/api/users/1", { method: "DELETE" });
			expect(req.method).toBe("DELETE");
		});

		it("creates PUT request with body", async () => {
			const req = createRequest("/api/users/1", {
				method: "PUT",
				body: { name: "Updated" },
			});

			expect(req.method).toBe("PUT");
			const body = await req.json();
			expect(body).toEqual({ name: "Updated" });
		});
	});

	describe("createExecutionContext captures waitUntil promises", () => {
		it("creates a valid ExecutionContext", () => {
			const ctx = createExecutionContext();
			expect(ctx.waitUntil).toBeDefined();
			expect(ctx.passThroughOnException).toBeDefined();
			expect(ctx._promises).toEqual([]);
		});

		it("captures waitUntil promises", () => {
			const ctx = createExecutionContext();
			const p1 = Promise.resolve("done");
			const p2 = Promise.resolve(42);

			ctx.waitUntil(p1);
			ctx.waitUntil(p2);

			expect(ctx._promises).toHaveLength(2);
			expect(ctx._promises[0]).toBe(p1);
			expect(ctx._promises[1]).toBe(p2);
		});

		it("passThroughOnException is callable without error", () => {
			const ctx = createExecutionContext();
			expect(() => ctx.passThroughOnException()).not.toThrow();
		});

		it("can await all captured promises", async () => {
			const ctx = createExecutionContext();
			const results: string[] = [];

			ctx.waitUntil(
				new Promise<void>((resolve) => {
					results.push("a");
					resolve();
				}),
			);
			ctx.waitUntil(
				new Promise<void>((resolve) => {
					results.push("b");
					resolve();
				}),
			);

			await Promise.all(ctx._promises);
			expect(results).toEqual(["a", "b"]);
		});
	});
});
