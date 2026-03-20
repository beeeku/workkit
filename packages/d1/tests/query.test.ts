import { beforeEach, describe, expect, it } from "vitest";
import { D1Error } from "../src/errors";
import {
	DeleteBuilderImpl,
	InsertBuilderImpl,
	SelectBuilderImpl,
	UpdateBuilderImpl,
	compileWhere,
	escapeIdentifier,
} from "../src/query";
import { createMockD1 } from "./helpers/mock-d1";

type User = { id: number; name: string; email: string; active: boolean; age: number };

describe("escapeIdentifier", () => {
	it("passes through simple alphanumeric names", () => {
		expect(escapeIdentifier("users")).toBe("users");
		expect(escapeIdentifier("id")).toBe("id");
		expect(escapeIdentifier("created_at")).toBe("created_at");
	});

	it("passes through dotted names (table.column)", () => {
		expect(escapeIdentifier("users.id")).toBe("users.id");
	});

	it("escapes names with special characters", () => {
		expect(escapeIdentifier("my column")).toBe('"my column"');
		expect(escapeIdentifier("table-name")).toBe('"table-name"');
	});

	it("prevents SQL injection by double-quoting", () => {
		const malicious = 'users"; DROP TABLE users; --';
		const escaped = escapeIdentifier(malicious);
		expect(escaped).toBe('"users""; DROP TABLE users; --"');
		// The double-quotes inside are escaped as ""
	});

	it("escapes names starting with numbers", () => {
		expect(escapeIdentifier("123abc")).toBe('"123abc"');
	});
});

describe("compileWhere", () => {
	it('compiles object condition: { id: 1 } -> "id = ?"', () => {
		const result = compileWhere({ id: 1 });
		expect(result.sql).toBe("id = ?");
		expect(result.params).toEqual([1]);
	});

	it("compiles multiple object keys with AND", () => {
		const result = compileWhere({ active: true, role: "admin" });
		expect(result.sql).toBe("active = ? AND role = ?");
		expect(result.params).toEqual([true, "admin"]);
	});

	it('compiles two-element tuple: ["id", 1] -> "id = ?"', () => {
		const result = compileWhere(["id", 1] as [string, unknown]);
		expect(result.sql).toBe("id = ?");
		expect(result.params).toEqual([1]);
	});

	it('compiles IS NULL: ["deleted_at", "IS NULL"]', () => {
		const result = compileWhere(["deleted_at", "IS NULL"] as [string, "IS NULL"]);
		expect(result.sql).toBe("deleted_at IS NULL");
		expect(result.params).toEqual([]);
	});

	it('compiles IS NOT NULL: ["deleted_at", "IS NOT NULL"]', () => {
		const result = compileWhere(["deleted_at", "IS NOT NULL"] as [string, "IS NOT NULL"]);
		expect(result.sql).toBe("deleted_at IS NOT NULL");
		expect(result.params).toEqual([]);
	});

	it('compiles operator tuple: ["age", ">", 18]', () => {
		const result = compileWhere(["age", ">", 18] as [string, ">", number]);
		expect(result.sql).toBe("age > ?");
		expect(result.params).toEqual([18]);
	});

	it('compiles IN clause: ["status", "IN", ["active", "pending"]]', () => {
		const result = compileWhere(["status", "IN", ["active", "pending"]] as [
			string,
			"IN",
			unknown[],
		]);
		expect(result.sql).toBe("status IN (?, ?)");
		expect(result.params).toEqual(["active", "pending"]);
	});

	it("compiles NOT IN clause", () => {
		const result = compileWhere(["status", "NOT IN", ["deleted", "banned"]] as [
			string,
			"NOT IN",
			unknown[],
		]);
		expect(result.sql).toBe("status NOT IN (?, ?)");
		expect(result.params).toEqual(["deleted", "banned"]);
	});

	it('compiles BETWEEN clause: ["age", "BETWEEN", [18, 65]]', () => {
		const result = compileWhere(["age", "BETWEEN", [18, 65]] as [
			string,
			"BETWEEN",
			[number, number],
		]);
		expect(result.sql).toBe("age BETWEEN ? AND ?");
		expect(result.params).toEqual([18, 65]);
	});

	it("compiles LIKE operator", () => {
		const result = compileWhere(["name", "LIKE", "%alice%"] as [string, "LIKE", string]);
		expect(result.sql).toBe("name LIKE ?");
		expect(result.params).toEqual(["%alice%"]);
	});

	it("uses parameter binding (never string interpolation)", () => {
		const result = compileWhere({ name: "Robert'; DROP TABLE users;--" });
		expect(result.sql).toBe("name = ?");
		expect(result.params).toEqual(["Robert'; DROP TABLE users;--"]);
		// The dangerous value is in params, not interpolated into SQL
		expect(result.sql).not.toContain("Robert");
	});
});

describe("SelectBuilder", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [
				{ id: 1, name: "Alice", email: "alice@test.com", active: true, age: 30 },
				{ id: 2, name: "Bob", email: "bob@test.com", active: true, age: 25 },
				{ id: 3, name: "Charlie", email: "charlie@test.com", active: false, age: 35 },
			],
		});
	});

	it("generates basic SELECT * FROM table", () => {
		const builder = new SelectBuilderImpl<User>(db, "users");
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users");
		expect(params).toEqual([]);
	});

	it("generates SELECT with specific columns", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").columns("id", "name");
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT id, name FROM users");
	});

	it("generates WHERE from object condition", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where({ active: true });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (active = ?)");
		expect(params).toEqual([true]);
	});

	it("generates WHERE from tuple condition with operator", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where(["age", ">", 18] as [
			string,
			">",
			number,
		]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (age > ?)");
		expect(params).toEqual([18]);
	});

	it("generates WHERE IN clause", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where(["id", "IN", [1, 2, 3]] as [
			string,
			"IN",
			unknown[],
		]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (id IN (?, ?, ?))");
		expect(params).toEqual([1, 2, 3]);
	});

	it("generates WHERE BETWEEN clause", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where(["age", "BETWEEN", [20, 40]] as [
			string,
			"BETWEEN",
			[number, number],
		]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (age BETWEEN ? AND ?)");
		expect(params).toEqual([20, 40]);
	});

	it("generates WHERE IS NULL", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where(["deleted_at", "IS NULL"] as [
			string,
			"IS NULL",
		]);
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (deleted_at IS NULL)");
	});

	it("generates WHERE IS NOT NULL", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where(["email", "IS NOT NULL"] as [
			string,
			"IS NOT NULL",
		]);
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (email IS NOT NULL)");
	});

	it("chains AND WHERE conditions", () => {
		const builder = new SelectBuilderImpl<User>(db, "users")
			.where({ active: true })
			.andWhere(["age", ">", 25] as [string, ">", number]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (active = ?) AND (age > ?)");
		expect(params).toEqual([true, 25]);
	});

	it("chains OR WHERE conditions", () => {
		const builder = new SelectBuilderImpl<User>(db, "users")
			.where({ name: "Alice" })
			.orWhere({ name: "Bob" });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (name = ?) OR (name = ?)");
		expect(params).toEqual(["Alice", "Bob"]);
	});

	it("generates ORDER BY single column", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").orderBy("name");
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users ORDER BY name ASC");
	});

	it("generates ORDER BY with DESC", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").orderBy("created_at", "desc");
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users ORDER BY created_at DESC");
	});

	it("generates LIMIT and OFFSET", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").limit(10).offset(20);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users LIMIT ? OFFSET ?");
		expect(params).toEqual([10, 20]);
	});

	it("generates GROUP BY", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").groupBy("active");
		const { sql } = builder.toSQL();
		expect(sql).toContain("GROUP BY active");
	});

	it("generates HAVING", () => {
		const builder = new SelectBuilderImpl<User>(db, "users")
			.groupBy("active")
			.having("COUNT(*) > ?", [5]);
		const { sql, params } = builder.toSQL();
		expect(sql).toContain("HAVING COUNT(*) > ?");
		expect(params).toContain(5);
	});

	it("generates combined complex query", () => {
		const builder = new SelectBuilderImpl<User>(db, "users")
			.columns("id", "name")
			.where({ active: true })
			.andWhere(["age", ">=", 18] as [string, ">=", number])
			.orderBy("name", "ASC")
			.limit(10)
			.offset(0);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe(
			"SELECT id, name FROM users WHERE (active = ?) AND (age >= ?) ORDER BY name ASC LIMIT ? OFFSET ?",
		);
		expect(params).toEqual([true, 18, 10, 0]);
	});

	it("all() executes and returns typed results", async () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where({ active: true });
		const users = await builder.all();
		expect(users).toHaveLength(2);
		expect(users[0].name).toBe("Alice");
	});

	it("first() executes with LIMIT 1", async () => {
		const builder = new SelectBuilderImpl<User>(db, "users");
		const user = await builder.first();
		expect(user).toBeDefined();
		expect(user?.id).toBe(1);
	});

	it("count() uses COUNT(*)", async () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where({ active: true });
		const count = await builder.count();
		expect(count).toBe(2);
	});

	it("toSQL() returns SQL and params without executing", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where({ id: 1 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (id = ?)");
		expect(params).toEqual([1]);
	});

	it("where() accepts raw SQL string", () => {
		const builder = new SelectBuilderImpl<User>(db, "users").where("age > ? AND name LIKE ?", [
			18,
			"%A%",
		]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (age > ? AND name LIKE ?)");
		expect(params).toEqual([18, "%A%"]);
	});
});

describe("InsertBuilder", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({ users: [] });
	});

	it("generates INSERT INTO ... VALUES", () => {
		const builder = new InsertBuilderImpl(db, "users").values({
			name: "Alice",
			email: "alice@test.com",
		});
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("INSERT INTO users (name, email) VALUES (?, ?)");
		expect(params).toEqual(["Alice", "alice@test.com"]);
	});

	it("generates multi-row INSERT", () => {
		const builder = new InsertBuilderImpl(db, "users").values([
			{ name: "Alice", email: "a@test.com" },
			{ name: "Bob", email: "b@test.com" },
		]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("INSERT INTO users (name, email) VALUES (?, ?), (?, ?)");
		expect(params).toEqual(["Alice", "a@test.com", "Bob", "b@test.com"]);
	});

	it("generates ON CONFLICT DO NOTHING (ignore)", () => {
		const builder = new InsertBuilderImpl(db, "users")
			.values({ name: "Alice" })
			.onConflict("ignore");
		const { sql } = builder.toSQL();
		expect(sql).toContain("OR IGNORE");
	});

	it("generates ON CONFLICT DO REPLACE", () => {
		const builder = new InsertBuilderImpl(db, "users")
			.values({ name: "Alice" })
			.onConflict("replace");
		const { sql } = builder.toSQL();
		expect(sql).toContain("OR REPLACE");
	});

	it("generates ON CONFLICT with columns and DO NOTHING", () => {
		const builder = new InsertBuilderImpl(db, "users")
			.values({ name: "Alice", email: "a@test.com" })
			.onConflict(["email"], { do: "nothing" });
		const { sql } = builder.toSQL();
		expect(sql).toContain("ON CONFLICT (email) DO NOTHING");
	});

	it("generates ON CONFLICT with columns and DO UPDATE", () => {
		const builder = new InsertBuilderImpl(db, "users")
			.values({ name: "Alice", email: "a@test.com" })
			.onConflict(["email"], { do: "update", set: { name: "Alice Updated" } });
		const { sql, params } = builder.toSQL();
		expect(sql).toContain("ON CONFLICT (email) DO UPDATE SET name = ?");
		expect(params).toContain("Alice Updated");
	});

	it("generates INSERT ... RETURNING", () => {
		const builder = new InsertBuilderImpl(db, "users").values({ name: "Alice" }).returning("*");
		const { sql } = builder.toSQL();
		expect(sql).toContain("RETURNING *");
	});

	it("toSQL() returns SQL and params", () => {
		const builder = new InsertBuilderImpl(db, "users").values({ name: "Test" });
		const { sql, params } = builder.toSQL();
		expect(typeof sql).toBe("string");
		expect(Array.isArray(params)).toBe(true);
	});

	it("run() executes the insert", async () => {
		const builder = new InsertBuilderImpl(db, "users").values({
			name: "Alice",
			email: "a@test.com",
		});
		const result = await builder.run();
		expect(result.success).toBe(true);
		expect(result.meta.changes).toBe(1);
	});
});

describe("UpdateBuilder", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [
				{ id: 1, name: "Alice", email: "alice@test.com", active: true },
				{ id: 2, name: "Bob", email: "bob@test.com", active: true },
			],
		});
	});

	it("generates UPDATE SET with WHERE", () => {
		const builder = new UpdateBuilderImpl(db, "users").set({ active: false }).where({ id: 1 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("UPDATE users SET active = ? WHERE (id = ?)");
		expect(params).toEqual([false, 1]);
	});

	it("generates UPDATE ... RETURNING", () => {
		const builder = new UpdateBuilderImpl(db, "users")
			.set({ active: false })
			.where({ id: 1 })
			.returning("*");
		const { sql } = builder.toSQL();
		expect(sql).toContain("RETURNING *");
	});

	it("throws without WHERE (safety check)", async () => {
		const builder = new UpdateBuilderImpl(db, "users").set({ active: false });
		await expect(builder.run()).rejects.toThrow();
	});

	it("run() executes the update", async () => {
		const builder = new UpdateBuilderImpl(db, "users").set({ name: "Updated" }).where({ id: 1 });
		const result = await builder.run();
		expect(result.success).toBe(true);
		expect(result.meta.changes).toBe(1);
	});

	it("toSQL() returns SQL and params", () => {
		const builder = new UpdateBuilderImpl(db, "users").set({ name: "Test" }).where({ id: 1 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("UPDATE users SET name = ? WHERE (id = ?)");
		expect(params).toEqual(["Test", 1]);
	});
});

describe("DeleteBuilder", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			],
		});
	});

	it("generates DELETE FROM with WHERE", () => {
		const builder = new DeleteBuilderImpl(db, "users").where({ id: 1 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("DELETE FROM users WHERE (id = ?)");
		expect(params).toEqual([1]);
	});

	it("generates DELETE ... RETURNING", () => {
		const builder = new DeleteBuilderImpl(db, "users").where({ id: 1 }).returning("*");
		const { sql } = builder.toSQL();
		expect(sql).toContain("RETURNING *");
	});

	it("throws without WHERE (safety check)", async () => {
		const builder = new DeleteBuilderImpl(db, "users");
		await expect(builder.run()).rejects.toThrow();
	});

	it("run() executes the delete", async () => {
		const builder = new DeleteBuilderImpl(db, "users").where({ id: 1 });
		const result = await builder.run();
		expect(result.success).toBe(true);
		expect(result.meta.changes).toBe(1);
	});

	it("toSQL() returns SQL and params", () => {
		const builder = new DeleteBuilderImpl(db, "users").where({ id: 2 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("DELETE FROM users WHERE (id = ?)");
		expect(params).toEqual([2]);
	});

	it("generates DELETE ... RETURNING with specific columns", () => {
		const builder = new DeleteBuilderImpl(db, "users").where({ id: 1 }).returning("id", "name");
		const { sql } = builder.toSQL();
		expect(sql).toContain("RETURNING id, name");
	});
});

describe("compileWhere edge cases", () => {
	it("throws D1Error for invalid (non-object, non-array) condition", () => {
		expect(() => compileWhere("invalid" as any)).toThrow(D1Error);
	});

	it("compiles NOT IN with empty array", () => {
		const result = compileWhere(["status", "NOT IN", []] as [string, "NOT IN", unknown[]]);
		expect(result.sql).toBe("status NOT IN ()");
		expect(result.params).toEqual([]);
	});

	it("compiles object condition with special characters in keys", () => {
		const result = compileWhere({ "my column": "value" });
		expect(result.sql).toBe('"my column" = ?');
		expect(result.params).toEqual(["value"]);
	});

	it("handles null values in object conditions", () => {
		const result = compileWhere({ name: null });
		expect(result.sql).toBe("name = ?");
		expect(result.params).toEqual([null]);
	});

	it("handles empty object condition", () => {
		const result = compileWhere({});
		expect(result.sql).toBe("");
		expect(result.params).toEqual([]);
	});
});

describe("escapeIdentifier edge cases", () => {
	it("escapes identifiers with embedded double quotes", () => {
		const escaped = escapeIdentifier('col"name');
		expect(escaped).toBe('"col""name"');
	});

	it("escapes identifiers starting with underscore", () => {
		expect(escapeIdentifier("_private")).toBe("_private");
	});

	it("passes through identifiers with underscores and numbers", () => {
		expect(escapeIdentifier("table_2_name")).toBe("table_2_name");
	});

	it("escapes empty string", () => {
		expect(escapeIdentifier("")).toBe('""');
	});
});

describe("InsertBuilder edge cases", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({ users: [] });
	});

	it("throws D1Error when no values provided", () => {
		const builder = new InsertBuilderImpl(db, "users");
		expect(() => builder.toSQL()).toThrow("INSERT requires at least one row of values");
	});

	it("handles values with null fields", () => {
		const builder = new InsertBuilderImpl(db, "users").values({ name: "Alice", email: null });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("INSERT INTO users (name, email) VALUES (?, ?)");
		expect(params).toEqual(["Alice", null]);
	});

	it("handles values with undefined fields", () => {
		const builder = new InsertBuilderImpl(db, "users").values({ name: "Alice", bio: undefined });
		const { params } = builder.toSQL();
		expect(params).toContain(undefined);
	});
});

describe("UpdateBuilder edge cases", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [{ id: 1, name: "Alice", active: true }],
		});
	});

	it("throws specific error message for UPDATE without WHERE", async () => {
		const builder = new UpdateBuilderImpl(db, "users").set({ active: false });
		await expect(builder.run()).rejects.toThrow("UPDATE without WHERE is not allowed");
	});

	it("merges multiple set() calls", () => {
		const builder = new UpdateBuilderImpl(db, "users")
			.set({ name: "Bob" })
			.set({ active: false })
			.where({ id: 1 });
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("UPDATE users SET name = ?, active = ? WHERE (id = ?)");
		expect(params).toEqual(["Bob", false, 1]);
	});

	it("generates UPDATE with raw SQL where clause", () => {
		const builder = new UpdateBuilderImpl(db, "users")
			.set({ active: false })
			.where("id > ? AND id < ?", [10, 20]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("UPDATE users SET active = ? WHERE (id > ? AND id < ?)");
		expect(params).toEqual([false, 10, 20]);
	});
});

describe("DeleteBuilder edge cases", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
	});

	it("throws specific error message for DELETE without WHERE", async () => {
		const builder = new DeleteBuilderImpl(db, "users");
		await expect(builder.run()).rejects.toThrow("DELETE without WHERE is not allowed");
	});

	it("generates DELETE with raw SQL where clause", () => {
		const builder = new DeleteBuilderImpl(db, "users").where("created_at < ?", ["2020-01-01"]);
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("DELETE FROM users WHERE (created_at < ?)");
		expect(params).toEqual(["2020-01-01"]);
	});
});

describe("SelectBuilder edge cases", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [
				{ id: 1, name: "Alice", age: 30 },
				{ id: 2, name: "Bob", age: 25 },
			],
		});
	});

	it("columns with aggregates pass through unescaped", () => {
		const builder = new SelectBuilderImpl(db, "users").columns("COUNT(*)");
		const { sql } = builder.toSQL();
		expect(sql).toBe("SELECT COUNT(*) FROM users");
	});

	it("first() auto-sets LIMIT 1 when not specified", async () => {
		const builder = new SelectBuilderImpl(db, "users");
		const { sql } = builder.toSQL();
		expect(sql).not.toContain("LIMIT");
		// After calling first(), LIMIT should be set internally
		const user = await builder.first();
		expect(user).toBeDefined();
	});

	it("supports multiple orderBy calls", () => {
		const builder = new SelectBuilderImpl(db, "users")
			.orderBy("name", "ASC")
			.orderBy("age", "desc");
		const { sql } = builder.toSQL();
		expect(sql).toContain("ORDER BY name ASC, age DESC");
	});

	it("having() without groupBy still generates SQL", () => {
		const builder = new SelectBuilderImpl(db, "users").having("COUNT(*) > ?", [1]);
		const { sql } = builder.toSQL();
		expect(sql).toContain("HAVING COUNT(*) > ?");
	});

	it("where with raw SQL and no params defaults to empty array", () => {
		const builder = new SelectBuilderImpl(db, "users").where("1 = 1");
		const { sql, params } = builder.toSQL();
		expect(sql).toBe("SELECT * FROM users WHERE (1 = 1)");
		expect(params).toEqual([]);
	});
});
