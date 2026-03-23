import { d1 } from "@workkit/d1";
import { kv } from "@workkit/kv";
import { describe, expect, it } from "vitest";
import { createMockD1, createMockKV, createTestEnv } from "./helpers/setup";

interface User {
	id: number;
	name: string;
	email: string;
	active: boolean;
}

describe("KV + D1 cross-package flow", () => {
	it("stores data in D1 and caches in KV", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:" });

		// Create table and insert into D1
		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@example.com",
			1,
		]);

		// Query from D1
		const user = await db.first<User>("SELECT * FROM users WHERE name = ?", ["Alice"]);
		expect(user).not.toBeNull();
		expect(user!.name).toBe("Alice");

		// Cache in KV
		await cache.put("alice", user!);
		const cached = await cache.get("alice");
		expect(cached).not.toBeNull();
		expect(cached!.name).toBe("Alice");
		expect(cached!.email).toBe("alice@example.com");
	});

	it("uses KV as a write-through cache for D1 data", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:", defaultTtl: 3600 });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);

		// Insert multiple users
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			1,
		]);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Bob",
			"bob@test.com",
			1,
		]);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Charlie",
			"charlie@test.com",
			0,
		]);

		// Query all active users from D1
		const activeUsers = await db.all<User>("SELECT * FROM users WHERE active = ?", [1]);
		expect(activeUsers).toHaveLength(2);

		// Cache each user in KV
		for (const u of activeUsers) {
			await cache.put(String(u.id), u);
		}

		// Verify KV has both users
		const alice = await cache.get("1");
		const bob = await cache.get("2");
		expect(alice!.name).toBe("Alice");
		expect(bob!.name).toBe("Bob");

		// Verify inactive user is not cached
		const charlie = await cache.get("3");
		expect(charlie).toBeNull();
	});

	it("invalidates KV cache when D1 data changes", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			1,
		]);

		const user = await db.first<User>("SELECT * FROM users WHERE id = ?", [1]);
		await cache.put("1", user!);

		// Update in D1
		await db.run("UPDATE users SET email = ? WHERE id = ?", ["alice-new@test.com", 1]);

		// Delete from KV cache (invalidation)
		await cache.delete("1");
		const stale = await cache.get("1");
		expect(stale).toBeNull();

		// Re-fetch and re-cache
		const fresh = await db.first<User>("SELECT * FROM users WHERE id = ?", [1]);
		await cache.put("1", fresh!);
		const reCached = await cache.get("1");
		expect(reCached!.email).toBe("alice-new@test.com");
	});

	it("uses D1 query builder with KV caching", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User[]>(env.CACHE, { prefix: "query:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			1,
		]);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Bob",
			"bob@test.com",
			0,
		]);

		// Use query builder
		const results = await db.select<User>("users").where("active = ?", [1]).all();
		expect(results).toHaveLength(1);

		// Cache the query result
		await cache.put("active-users", results);
		const cached = await cache.get("active-users");
		expect(cached).toHaveLength(1);
		expect(cached![0].name).toBe("Alice");
	});

	it("handles batch operations across KV and D1", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);

		// Insert users individually (batch via d1 client requires BoundStatement format)
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"a@test.com",
			1,
		]);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Bob",
			"b@test.com",
			1,
		]);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Charlie",
			"c@test.com",
			1,
		]);

		// Batch cache in KV using putMany
		const all = await db.all<User>("SELECT * FROM users");
		await cache.putMany(all.map((u) => ({ key: String(u.id), value: u })));

		// Verify all are cached
		for (const u of all) {
			const c = await cache.get(String(u.id));
			expect(c).not.toBeNull();
			expect(c!.name).toBe(u.name);
		}
	});

	it("uses KV prefix namespacing for different entity types", async () => {
		const mockKV = createMockKV();
		const mockDB = createMockD1();

		const db = d1(mockDB);
		const userCache = kv<User>(mockKV, { prefix: "user:" });
		const sessionCache = kv<{ userId: number; token: string }>(mockKV, { prefix: "session:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			1,
		]);

		const user = await db.first<User>("SELECT * FROM users WHERE id = ?", [1]);
		await userCache.put("1", user!);
		await sessionCache.put("abc123", { userId: 1, token: "xyz" });

		// Both exist in the same KV namespace with different prefixes
		const cachedUser = await userCache.get("1");
		const cachedSession = await sessionCache.get("abc123");
		expect(cachedUser!.name).toBe("Alice");
		expect(cachedSession!.token).toBe("xyz");

		// Cross-prefix isolation: user cache does not see sessions
		const noResult = await userCache.get("abc123");
		expect(noResult).toBeNull();
	});

	it("handles KV metadata alongside D1 data", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			1,
		]);

		const user = await db.first<User>("SELECT * FROM users WHERE id = ?", [1]);

		// Store with metadata
		await cache.put("1", user!, {
			metadata: { cachedAt: Date.now(), source: "d1" },
		});

		const result = await cache.getWithMetadata<{ cachedAt: number; source: string }>("1");
		expect(result.value).not.toBeNull();
		expect(result.value!.name).toBe("Alice");
		expect(result.metadata).not.toBeNull();
		expect(result.metadata!.source).toBe("d1");
	});

	it("D1 camelCase transform works with KV storage", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB, { transformColumns: "camelCase" });
		const cache = kv<{ id: number; fullName: string; isActive: boolean }>(env.CACHE, {
			prefix: "user:",
		});

		await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, is_active INTEGER)");
		await db.run("INSERT INTO users (full_name, is_active) VALUES (?, ?)", ["Alice Smith", 1]);

		const user = await db.first<{ id: number; fullName: string; isActive: number }>(
			"SELECT * FROM users WHERE id = ?",
			[1],
		);
		expect(user!.fullName).toBe("Alice Smith");

		// Store transformed result in KV
		await cache.put("1", { id: user!.id, fullName: user!.fullName, isActive: !!user!.isActive });
		const cached = await cache.get("1");
		expect(cached!.fullName).toBe("Alice Smith");
	});

	it("lists KV entries that were populated from D1", async () => {
		const env = createTestEnv({
			kv: ["CACHE"] as const,
			d1: ["DB"] as const,
		});

		const db = d1(env.DB);
		const cache = kv<User>(env.CACHE, { prefix: "user:" });

		await db.exec(
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);
		for (let i = 1; i <= 5; i++) {
			await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
				`User${i}`,
				`user${i}@test.com`,
				1,
			]);
		}

		const all = await db.all<User>("SELECT * FROM users");
		for (const u of all) {
			await cache.put(String(u.id), u);
		}

		// List all cached users
		const keys = await cache.listKeys();
		expect(keys.length).toBe(5);
	});
});
