import { beforeEach, describe, expect, it } from "vitest";
import { createFailingD1, createMockD1 } from "../src/d1";

describe("createMockD1", () => {
	let db: ReturnType<typeof createMockD1>;

	beforeEach(() => {
		db = createMockD1();
	});

	describe("CREATE TABLE", () => {
		it("creates a table", async () => {
			const result = await db
				.prepare("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
				.run();
			expect(result.success).toBe(true);
		});

		it("supports IF NOT EXISTS", async () => {
			await db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)").run();
			await db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)").run();
			// Should not throw
		});
	});

	describe("INSERT", () => {
		beforeEach(async () => {
			await db.prepare("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)").run();
		});

		it("inserts a row", async () => {
			const result = await db
				.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
				.bind("Alice", "alice@test.com")
				.run();
			expect(result.success).toBe(true);
			expect(result.meta.changes).toBe(1);
		});

		it("returns inserted row with RETURNING", async () => {
			const result = await db
				.prepare("INSERT INTO users (name, email) VALUES (?, ?) RETURNING *")
				.bind("Bob", "bob@test.com")
				.all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0]).toMatchObject({ name: "Bob", email: "bob@test.com" });
		});

		it("auto-increments id", async () => {
			await db.prepare("INSERT INTO users (name) VALUES (?)").bind("A").run();
			await db.prepare("INSERT INTO users (name) VALUES (?)").bind("B").run();
			const result = await db.prepare("SELECT * FROM users").all();
			expect(result.results[0].id).toBe(1);
			expect(result.results[1].id).toBe(2);
		});
	});

	describe("SELECT", () => {
		beforeEach(async () => {
			db = createMockD1({
				users: [
					{ id: 1, name: "Alice", age: 30 },
					{ id: 2, name: "Bob", age: 25 },
					{ id: 3, name: "Charlie", age: 35 },
				],
			});
		});

		it("selects all rows", async () => {
			const result = await db.prepare("SELECT * FROM users").all();
			expect(result.results).toHaveLength(3);
		});

		it("selects specific columns", async () => {
			const result = await db.prepare("SELECT name FROM users").all();
			expect(result.results[0]).toEqual({ name: "Alice" });
			expect(result.results[0]).not.toHaveProperty("id");
		});

		it("filters with WHERE =", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE name = ?").bind("Bob").all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Bob");
		});

		it("filters with WHERE !=", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE name != ?").bind("Bob").all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE >", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE age > ?").bind(28).all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE <", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE age < ?").bind(30).all();
			expect(result.results).toHaveLength(1);
		});

		it("filters with WHERE >=", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE age >= ?").bind(30).all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE <=", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE age <= ?").bind(30).all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE LIKE", async () => {
			const result = await db.prepare("SELECT * FROM users WHERE name LIKE ?").bind("A%").all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Alice");
		});

		it("filters with WHERE IN", async () => {
			const result = await db
				.prepare("SELECT * FROM users WHERE name IN (?, ?)")
				.bind("Alice", "Charlie")
				.all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE NOT IN", async () => {
			const result = await db
				.prepare("SELECT * FROM users WHERE name NOT IN (?)")
				.bind("Bob")
				.all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE BETWEEN", async () => {
			const result = await db
				.prepare("SELECT * FROM users WHERE age BETWEEN ? AND ?")
				.bind(25, 30)
				.all();
			expect(result.results).toHaveLength(2);
		});

		it("filters with WHERE IS NULL", async () => {
			db = createMockD1({
				users: [
					{ id: 1, name: "Alice", email: null },
					{ id: 2, name: "Bob", email: "bob@test.com" },
				],
			});
			const result = await db.prepare("SELECT * FROM users WHERE email IS NULL").all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Alice");
		});

		it("filters with WHERE IS NOT NULL", async () => {
			db = createMockD1({
				users: [
					{ id: 1, name: "Alice", email: null },
					{ id: 2, name: "Bob", email: "bob@test.com" },
				],
			});
			const result = await db.prepare("SELECT * FROM users WHERE email IS NOT NULL").all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Bob");
		});

		it("supports ORDER BY ASC", async () => {
			const result = await db.prepare("SELECT * FROM users ORDER BY age ASC").all();
			expect(result.results[0].name).toBe("Bob");
			expect(result.results[2].name).toBe("Charlie");
		});

		it("supports ORDER BY DESC", async () => {
			const result = await db.prepare("SELECT * FROM users ORDER BY age DESC").all();
			expect(result.results[0].name).toBe("Charlie");
		});

		it("supports LIMIT", async () => {
			const result = await db.prepare("SELECT * FROM users LIMIT ?").bind(2).all();
			expect(result.results).toHaveLength(2);
		});

		it("supports LIMIT with OFFSET", async () => {
			const result = await db.prepare("SELECT * FROM users LIMIT ? OFFSET ?").bind(1, 1).all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Bob");
		});

		it("supports COUNT(*)", async () => {
			const result = await db.prepare("SELECT COUNT(*) as count FROM users").all();
			expect(result.results[0].count).toBe(3);
		});

		it("first() returns first row", async () => {
			const row = await db.prepare("SELECT * FROM users WHERE name = ?").bind("Alice").first();
			expect(row).toMatchObject({ name: "Alice", age: 30 });
		});

		it("first() returns null when no match", async () => {
			const row = await db.prepare("SELECT * FROM users WHERE name = ?").bind("Nobody").first();
			expect(row).toBeNull();
		});

		it("first(colName) returns column value", async () => {
			const name = await db.prepare("SELECT * FROM users WHERE id = ?").bind(1).first("name");
			expect(name).toBe("Alice");
		});

		it("raw() returns arrays of values", async () => {
			const rows = await db.prepare("SELECT name FROM users WHERE id = ?").bind(1).raw();
			expect(rows[0]).toEqual(["Alice"]);
		});
	});

	describe("UPDATE", () => {
		beforeEach(async () => {
			db = createMockD1({
				users: [
					{ id: 1, name: "Alice", age: 30 },
					{ id: 2, name: "Bob", age: 25 },
				],
			});
		});

		it("updates matching rows", async () => {
			const result = await db
				.prepare("UPDATE users SET age = ? WHERE name = ?")
				.bind(31, "Alice")
				.run();
			expect(result.meta.changes).toBe(1);
			const row = await db.prepare("SELECT * FROM users WHERE name = ?").bind("Alice").first();
			expect(row!.age).toBe(31);
		});

		it("returns updated rows with RETURNING", async () => {
			const result = await db
				.prepare("UPDATE users SET age = ? WHERE name = ? RETURNING *")
				.bind(31, "Alice")
				.all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].age).toBe(31);
		});
	});

	describe("DELETE", () => {
		beforeEach(async () => {
			db = createMockD1({
				users: [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
					{ id: 3, name: "Charlie" },
				],
			});
		});

		it("deletes matching rows", async () => {
			const result = await db.prepare("DELETE FROM users WHERE name = ?").bind("Bob").run();
			expect(result.meta.changes).toBe(1);
			const all = await db.prepare("SELECT * FROM users").all();
			expect(all.results).toHaveLength(2);
		});

		it("returns deleted rows with RETURNING", async () => {
			const result = await db
				.prepare("DELETE FROM users WHERE name = ? RETURNING *")
				.bind("Bob")
				.all();
			expect(result.results).toHaveLength(1);
			expect(result.results[0].name).toBe("Bob");
		});
	});

	describe("DROP TABLE", () => {
		it("drops a table", async () => {
			db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
			await db.prepare("DROP TABLE users").run();
			await expect(db.prepare("SELECT * FROM users").all()).rejects.toThrow();
		});
	});

	describe("batch", () => {
		it("executes multiple statements", async () => {
			db = createMockD1({ users: [] });
			const results = await db.batch([
				db.prepare("INSERT INTO users (name) VALUES (?)").bind("Alice"),
				db.prepare("INSERT INTO users (name) VALUES (?)").bind("Bob"),
			]);
			expect(results).toHaveLength(2);
			const all = await db.prepare("SELECT * FROM users").all();
			expect(all.results).toHaveLength(2);
		});
	});

	describe("exec", () => {
		it("executes multiple SQL statements", async () => {
			const result = await db.exec("CREATE TABLE t1 (id INTEGER); CREATE TABLE t2 (id INTEGER)");
			expect(result.count).toBe(2);
		});
	});
});

describe("createFailingD1", () => {
	it("throws on prepare().first()", async () => {
		const db = createFailingD1("DB error");
		await expect(db.prepare("SELECT 1").first()).rejects.toThrow("DB error");
	});

	it("throws on prepare().all()", async () => {
		const db = createFailingD1(new Error("custom error"));
		await expect(db.prepare("SELECT 1").all()).rejects.toThrow("custom error");
	});

	it("throws on prepare().run()", async () => {
		const db = createFailingD1("fail");
		await expect(db.prepare("SELECT 1").run()).rejects.toThrow("fail");
	});

	it("throws on prepare().raw()", async () => {
		const db = createFailingD1("fail");
		await expect(db.prepare("SELECT 1").raw()).rejects.toThrow("fail");
	});

	it("throws on batch()", async () => {
		const db = createFailingD1("fail");
		await expect(db.batch([])).rejects.toThrow("fail");
	});

	it("throws on exec()", async () => {
		const db = createFailingD1("fail");
		await expect(db.exec("SELECT 1")).rejects.toThrow("fail");
	});

	it("supports bind() chaining before failure", async () => {
		const db = createFailingD1("fail");
		await expect(db.prepare("SELECT ?").bind(1).first()).rejects.toThrow("fail");
	});
});
