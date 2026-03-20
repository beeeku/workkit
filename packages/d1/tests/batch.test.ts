import { beforeEach, describe, expect, it } from "vitest";
import { executeBatch } from "../src/batch";
import { D1BatchError } from "../src/errors";
import { createFailingD1, createMockD1 } from "./helpers/mock-d1";

describe("executeBatch", () => {
	let db: D1Database;

	beforeEach(() => {
		db = createMockD1({
			users: [],
		});
	});

	it("handles empty batch (returns [])", async () => {
		const results = await executeBatch(db, []);
		expect(results).toEqual([]);
	});

	it("executes multiple statements atomically", async () => {
		const stmt1 = db
			.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
			.bind("Alice", "a@test.com");
		const stmt2 = db
			.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
			.bind("Bob", "b@test.com");

		const results = await executeBatch(db, [
			{ statement: stmt1 as unknown as D1PreparedStatement },
			{ statement: stmt2 as unknown as D1PreparedStatement },
		]);

		expect(results).toHaveLength(2);
		expect(results[0].success).toBe(true);
		expect(results[1].success).toBe(true);
	});

	it("returns results for each statement", async () => {
		const stmt = db.prepare("INSERT INTO users (name) VALUES (?)").bind("Alice");

		const results = await executeBatch(db, [{ statement: stmt as unknown as D1PreparedStatement }]);

		expect(results).toHaveLength(1);
		expect(results[0]).toHaveProperty("results");
		expect(results[0]).toHaveProperty("success");
		expect(results[0]).toHaveProperty("meta");
	});

	it("wraps errors as D1BatchError", async () => {
		const failDb = createFailingD1("batch execution failed");

		const stmt = failDb.prepare("INSERT INTO users (name) VALUES (?)").bind("Alice");

		await expect(
			executeBatch(failDb, [{ statement: stmt as unknown as D1PreparedStatement }]),
		).rejects.toThrow(D1BatchError);
	});
});
