import { describe, expect, it } from "vitest";
import { createMockD1 } from "../src/d1";
import { createMockKV } from "../src/kv";

describe("KV seeding", () => {
	it("pre-populates KV with seed data", async () => {
		const kv = createMockKV({ "user:1": { name: "Alice" }, config: "dark" });
		expect(await kv.get("user:1", "json")).toEqual({ name: "Alice" });
		expect(await kv.get("config", "text")).toBe('"dark"');
	});

	it("stores seed values as JSON strings", () => {
		const kv = createMockKV({ key: { nested: true } });
		expect(kv._store.get("key")!.value).toBe('{"nested":true}');
	});

	it("stores string seed values as JSON strings", () => {
		const kv = createMockKV({ key: "hello" });
		expect(kv._store.get("key")!.value).toBe('"hello"');
	});

	it("stores number seed values as JSON strings", () => {
		const kv = createMockKV({ count: 42 });
		expect(kv._store.get("count")!.value).toBe("42");
	});

	it("works with empty seed data", async () => {
		const kv = createMockKV({});
		expect(kv._store.size).toBe(0);
	});

	it("works with no seed data (backwards compatible)", async () => {
		const kv = createMockKV();
		expect(kv._store.size).toBe(0);
		await kv.put("key", "value");
		expect(await kv.get("key")).toBe("value");
	});
});

describe("D1 seeding", () => {
	it("pre-populates D1 with seed tables", async () => {
		const db = createMockD1({
			users: [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			],
		});
		const result = await db.prepare("SELECT * FROM users").all();
		expect(result.results).toHaveLength(2);
	});

	it("seed data is queryable with WHERE", async () => {
		const db = createMockD1({
			users: [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			],
		});
		const result = await db.prepare("SELECT * FROM users WHERE name = ?").bind("Bob").first();
		expect(result).toMatchObject({ id: 2, name: "Bob" });
	});

	it("can INSERT into seeded tables", async () => {
		const db = createMockD1({
			users: [{ id: 1, name: "Alice" }],
		});
		await db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind(2, "Bob").run();
		const result = await db.prepare("SELECT * FROM users").all();
		expect(result.results).toHaveLength(2);
	});

	it("works with multiple seeded tables", async () => {
		const db = createMockD1({
			users: [{ id: 1, name: "Alice" }],
			posts: [{ id: 1, title: "Hello", author_id: 1 }],
		});
		const users = await db.prepare("SELECT * FROM users").all();
		const posts = await db.prepare("SELECT * FROM posts").all();
		expect(users.results).toHaveLength(1);
		expect(posts.results).toHaveLength(1);
	});

	it("works with no initial tables (backwards compatible)", async () => {
		const db = createMockD1();
		await db.exec("CREATE TABLE t (id INTEGER)");
		await db.prepare("INSERT INTO t (id) VALUES (?)").bind(1).run();
		const result = await db.prepare("SELECT * FROM t").all();
		expect(result.results).toHaveLength(1);
	});
});
