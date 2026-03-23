import { beforeEach, describe, expect, it } from "vitest";
import { d1 } from "../../src/client";
import { D1Error } from "../../src/errors";
import { createMockD1 } from "../helpers/mock-d1";

interface User {
	id: number;
	name: string;
	email: string;
	active: boolean;
}

/**
 * Full query lifecycle integration tests.
 * These tests exercise the complete flow: create table, insert, select, update, delete, batch.
 */
describe("Query lifecycle integration", () => {
	let db: ReturnType<typeof d1>;

	beforeEach(() => {
		const mock = createMockD1();
		db = d1(mock);
	});

	it("full CRUD lifecycle: create table, insert, select, update, delete", async () => {
		// 1. Create table
		await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);

		// 2. Insert via raw SQL
		const insertResult = await db.run("INSERT INTO users (name, email, active) VALUES (?, ?, ?)", [
			"Alice",
			"alice@test.com",
			true,
		]);
		expect(insertResult.success).toBe(true);
		expect(insertResult.meta.changes).toBe(1);

		// 3. Select the inserted row
		const user = await db.first<User>("SELECT * FROM users WHERE name = ?", ["Alice"]);
		expect(user).not.toBeNull();
		expect(user!.name).toBe("Alice");
		expect(user!.email).toBe("alice@test.com");

		// 4. Update the row
		const updateResult = await db.run("UPDATE users SET active = ? WHERE name = ?", [
			false,
			"Alice",
		]);
		expect(updateResult.success).toBe(true);
		expect(updateResult.meta.changes).toBe(1);

		// 5. Select updated row
		const updated = await db.first<User>("SELECT * FROM users WHERE name = ?", ["Alice"]);
		expect(updated!.active).toBe(false);

		// 6. Delete the row
		const deleteResult = await db.run("DELETE FROM users WHERE name = ?", ["Alice"]);
		expect(deleteResult.success).toBe(true);
		expect(deleteResult.meta.changes).toBe(1);

		// 7. Verify deletion
		const gone = await db.first<User>("SELECT * FROM users WHERE name = ?", ["Alice"]);
		expect(gone).toBeNull();
	});

	it("query builder CRUD lifecycle", async () => {
		// Create table
		await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);

		// Insert via builder
		const insertResult = await db
			.insert("users")
			.values({ name: "Bob", email: "bob@test.com", active: true })
			.run();
		expect(insertResult.success).toBe(true);

		// Select via builder
		const users = await db.select<User>("users").where({ name: "Bob" }).all();
		expect(users).toHaveLength(1);
		expect(users[0].name).toBe("Bob");

		// Select first via builder
		const bob = await db.select<User>("users").where({ name: "Bob" }).first();
		expect(bob).not.toBeNull();
		expect(bob!.email).toBe("bob@test.com");

		// Update via builder
		const updateResult = await db
			.update("users")
			.set({ active: false })
			.where({ name: "Bob" })
			.run();
		expect(updateResult.success).toBe(true);

		// Delete via builder
		const deleteResult = await db.delete("users").where({ name: "Bob" }).run();
		expect(deleteResult.success).toBe(true);
	});

	it("multi-row insert and select with ordering", async () => {
		await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, active INTEGER)",
		);

		// Multi-row insert
		const result = await db
			.insert("users")
			.values([
				{ name: "Alice", email: "a@test.com", active: true },
				{ name: "Bob", email: "b@test.com", active: true },
				{ name: "Charlie", email: "c@test.com", active: false },
			])
			.run();
		expect(result.success).toBe(true);

		// Select all
		const allUsers = await db.all<User>("SELECT * FROM users");
		expect(allUsers).toHaveLength(3);

		// Select with ORDER BY
		const ordered = await db.select<User>("users").orderBy("name", "ASC").all();
		expect(ordered[0].name).toBe("Alice");
		expect(ordered[1].name).toBe("Bob");
		expect(ordered[2].name).toBe("Charlie");

		// Select with LIMIT
		const limited = await db.select<User>("users").limit(2).all();
		expect(limited).toHaveLength(2);

		// Count
		const count = await db.select("users").where({ active: true }).count();
		expect(count).toBe(2);
	});

	it("prepared statement reuse across multiple queries", async () => {
		await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
		);

		// Insert some data
		await db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Alice", "a@test.com"]);
		await db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Bob", "b@test.com"]);
		await db.run("INSERT INTO users (name, email) VALUES (?, ?)", ["Charlie", "c@test.com"]);

		// Create a reusable prepared statement
		const findByName = db.prepare<User>("SELECT * FROM users WHERE name = ?");

		// Reuse with different params
		const alice = await findByName.first(["Alice"]);
		expect(alice?.name).toBe("Alice");

		const bob = await findByName.first(["Bob"]);
		expect(bob?.name).toBe("Bob");

		const charlie = await findByName.first(["Charlie"]);
		expect(charlie?.name).toBe("Charlie");

		const nobody = await findByName.first(["Nobody"]);
		expect(nobody).toBeNull();
	});

	it("batch operations for atomic multi-statement execution", async () => {
		await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
		);

		// Insert multiple rows atomically via batch
		const insertUser = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
		await db.batch([
			insertUser.bind(["Alice", "a@test.com"]),
			insertUser.bind(["Bob", "b@test.com"]),
			insertUser.bind(["Charlie", "c@test.com"]),
		]);

		// Verify all rows were inserted
		const users = await db.all<User>("SELECT * FROM users");
		expect(users).toHaveLength(3);
	});

	it("column transformation with camelCase option", async () => {
		const mock = createMockD1({
			users: [{ id: 1, first_name: "Alice", last_name: "Smith", is_active: true }],
		});
		const camelDb = d1(mock, { transformColumns: "camelCase" });

		// Raw query with transform
		const user = await camelDb.first<{
			id: number;
			firstName: string;
			lastName: string;
			isActive: boolean;
		}>("SELECT * FROM users WHERE id = ?", [1]);
		expect(user).not.toBeNull();
		expect(user!.firstName).toBe("Alice");
		expect(user!.lastName).toBe("Smith");
		expect(user!.isActive).toBe(true);

		// All with transform
		const users = await camelDb.all<{ id: number; firstName: string }>("SELECT * FROM users");
		expect(users[0]).toHaveProperty("firstName");
	});

	it("exec for DDL and multi-statement SQL", async () => {
		// Create multiple tables
		const result = await db.exec(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT)",
		);
		expect(result.count).toBeGreaterThanOrEqual(2);

		// Verify both tables exist by inserting into them
		await db.run("INSERT INTO users (name) VALUES (?)", ["Alice"]);
		await db.run("INSERT INTO posts (title) VALUES (?)", ["Hello World"]);

		const user = await db.first("SELECT * FROM users WHERE name = ?", ["Alice"]);
		expect(user).not.toBeNull();

		const post = await db.first("SELECT * FROM posts WHERE title = ?", ["Hello World"]);
		expect(post).not.toBeNull();
	});

	it("raw escape hatch provides direct D1Database access", () => {
		const mock = createMockD1();
		const client = d1(mock);
		expect(client.raw).toBe(mock);
		// Can call D1Database methods directly
		expect(typeof client.raw.prepare).toBe("function");
		expect(typeof client.raw.exec).toBe("function");
		expect(typeof client.raw.batch).toBe("function");
	});

	it("SELECT builder toSQL() for debugging without execution", () => {
		const { sql, params } = db
			.select<User>("users")
			.columns("id", "name")
			.where({ active: true })
			.andWhere(["age", ">", 18] as [string, ">", number])
			.orderBy("name", "ASC")
			.limit(10)
			.offset(0)
			.toSQL();

		expect(sql).toBe(
			"SELECT id, name FROM users WHERE (active = ?) AND (age > ?) ORDER BY name ASC LIMIT ? OFFSET ?",
		);
		expect(params).toEqual([true, 18, 10, 0]);
	});

	it("INSERT builder toSQL() for debugging", () => {
		const { sql, params } = db
			.insert("users")
			.values({ name: "Alice", email: "a@test.com" })
			.toSQL();

		expect(sql).toBe("INSERT INTO users (name, email) VALUES (?, ?)");
		expect(params).toEqual(["Alice", "a@test.com"]);
	});

	it("UPDATE builder safety: rejects UPDATE without WHERE", async () => {
		await db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
		await db.run("INSERT INTO users (name) VALUES (?)", ["Alice"]);

		// This should throw because no WHERE clause
		await expect(db.update("users").set({ name: "Changed" }).run()).rejects.toThrow(D1Error);
	});

	it("DELETE builder safety: rejects DELETE without WHERE", async () => {
		await db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
		await db.run("INSERT INTO users (name) VALUES (?)", ["Alice"]);

		// This should throw because no WHERE clause
		await expect(db.delete("users").run()).rejects.toThrow(D1Error);
	});

	it("SELECT with WHERE using multiple operators generates correct SQL", () => {
		// IN operator
		const inQuery = db
			.select<User>("users")
			.where(["name", "IN", ["Alice", "Bob"]] as [string, "IN", unknown[]])
			.toSQL();
		expect(inQuery.sql).toBe("SELECT * FROM users WHERE (name IN (?, ?))");
		expect(inQuery.params).toEqual(["Alice", "Bob"]);

		// BETWEEN operator
		const betweenQuery = db
			.select<User>("users")
			.where(["age", "BETWEEN", [18, 65]] as [string, "BETWEEN", [number, number]])
			.toSQL();
		expect(betweenQuery.sql).toBe("SELECT * FROM users WHERE (age BETWEEN ? AND ?)");
		expect(betweenQuery.params).toEqual([18, 65]);

		// IS NULL
		const nullQuery = db
			.select<User>("users")
			.where(["deleted_at", "IS NULL"] as [string, "IS NULL"])
			.toSQL();
		expect(nullQuery.sql).toBe("SELECT * FROM users WHERE (deleted_at IS NULL)");
		expect(nullQuery.params).toEqual([]);

		// Combined: where + andWhere with different operators
		const combinedQuery = db
			.select<User>("users")
			.where({ active: true })
			.andWhere(["age", ">=", 18] as [string, ">=", number])
			.orWhere(["name", "LIKE", "%admin%"] as [string, "LIKE", string])
			.toSQL();
		expect(combinedQuery.sql).toBe(
			"SELECT * FROM users WHERE (active = ?) AND (age >= ?) OR (name LIKE ?)",
		);
		expect(combinedQuery.params).toEqual([true, 18, "%admin%"]);
	});

	it("INSERT with RETURNING clause", async () => {
		const mock = createMockD1({ users: [] });
		const localDb = d1(mock);

		const inserted = await localDb
			.insert("users")
			.values({ name: "Alice", email: "a@test.com" })
			.returning<User>("*")
			.first();

		expect(inserted).not.toBeNull();
		expect(inserted!.name).toBe("Alice");
	});

	it("UPDATE with RETURNING clause", async () => {
		const mock = createMockD1({
			users: [{ id: 1, name: "Alice", email: "old@test.com", active: true }],
		});
		const localDb = d1(mock);

		const updated = await localDb
			.update("users")
			.set({ email: "new@test.com" })
			.where({ id: 1 })
			.returning<User>("*")
			.first();

		expect(updated).not.toBeNull();
		expect(updated!.email).toBe("new@test.com");
	});

	it("DELETE with RETURNING clause", async () => {
		const mock = createMockD1({
			users: [{ id: 1, name: "Alice", email: "a@test.com" }],
		});
		const localDb = d1(mock);

		const deleted = await localDb.delete("users").where({ id: 1 }).returning<User>("*").all();

		expect(deleted).toHaveLength(1);
		expect(deleted[0].name).toBe("Alice");
	});

	it("INSERT with ON CONFLICT DO NOTHING", async () => {
		const mock = createMockD1({ users: [] });
		const localDb = d1(mock);

		const { sql } = localDb
			.insert("users")
			.values({ name: "Alice", email: "a@test.com" })
			.onConflict("ignore")
			.toSQL();

		expect(sql).toContain("INSERT OR IGNORE INTO");
	});

	it("INSERT with ON CONFLICT columns DO UPDATE", async () => {
		const mock = createMockD1({ users: [] });
		const localDb = d1(mock);

		const { sql, params } = localDb
			.insert("users")
			.values({ name: "Alice", email: "a@test.com" })
			.onConflict(["email"], { do: "update", set: { name: "Alice Updated" } })
			.toSQL();

		expect(sql).toContain("ON CONFLICT (email) DO UPDATE SET name = ?");
		expect(params).toContain("Alice Updated");
	});
});
