import { beforeEach, describe, expect, it } from "vitest";
import { createMockDO } from "../src/do";

describe("createMockDO", () => {
	let storage: ReturnType<typeof createMockDO>;

	beforeEach(() => {
		storage = createMockDO();
	});

	describe("get", () => {
		it("returns undefined for missing keys", async () => {
			expect(await storage.get("missing")).toBeUndefined();
		});

		it("returns stored value for single key", async () => {
			await storage.put("key", "value");
			expect(await storage.get("key")).toBe("value");
		});

		it("returns Map for multiple keys", async () => {
			await storage.put("a", 1);
			await storage.put("b", 2);
			const result = await storage.get(["a", "b", "c"]);
			expect(result).toBeInstanceOf(Map);
			expect(result.get("a")).toBe(1);
			expect(result.get("b")).toBe(2);
			expect(result.has("c")).toBe(false);
		});
	});

	describe("put", () => {
		it("stores a single key-value", async () => {
			await storage.put("key", { complex: true });
			expect(await storage.get("key")).toEqual({ complex: true });
		});

		it("stores multiple entries from object", async () => {
			await storage.put({ a: 1, b: 2, c: 3 });
			expect(await storage.get("a")).toBe(1);
			expect(await storage.get("b")).toBe(2);
			expect(await storage.get("c")).toBe(3);
		});

		it("overwrites existing values", async () => {
			await storage.put("key", "old");
			await storage.put("key", "new");
			expect(await storage.get("key")).toBe("new");
		});
	});

	describe("delete", () => {
		it("deletes a single key and returns true", async () => {
			await storage.put("key", "val");
			const result = await storage.delete("key");
			expect(result).toBe(true);
			expect(await storage.get("key")).toBeUndefined();
		});

		it("returns false for missing single key", async () => {
			const result = await storage.delete("missing");
			expect(result).toBe(false);
		});

		it("deletes multiple keys and returns count", async () => {
			await storage.put("a", 1);
			await storage.put("b", 2);
			await storage.put("c", 3);
			const count = await storage.delete(["a", "b", "missing"]);
			expect(count).toBe(2);
			expect(await storage.get("a")).toBeUndefined();
			expect(await storage.get("c")).toBe(3);
		});
	});

	describe("list", () => {
		beforeEach(async () => {
			await storage.put("users:1", "Alice");
			await storage.put("users:2", "Bob");
			await storage.put("users:3", "Charlie");
			await storage.put("posts:1", "Post1");
		});

		it("lists all entries", async () => {
			const result = await storage.list();
			expect(result.size).toBe(4);
		});

		it("filters by prefix", async () => {
			const result = await storage.list({ prefix: "users:" });
			expect(result.size).toBe(3);
		});

		it("limits results", async () => {
			const result = await storage.list({ limit: 2 });
			expect(result.size).toBe(2);
		});

		it("filters by start (inclusive)", async () => {
			const result = await storage.list({ start: "users:2" });
			expect(result.size).toBe(2);
			expect(result.has("users:2")).toBe(true);
			expect(result.has("users:3")).toBe(true);
		});

		it("filters by end (exclusive)", async () => {
			const result = await storage.list({ end: "users:2" });
			// posts:1 and users:1 come before users:2
			expect(result.has("users:2")).toBe(false);
		});

		it("reverses order", async () => {
			const result = await storage.list({ reverse: true, limit: 2 });
			const keys = [...result.keys()];
			expect(keys[0] > keys[1]).toBe(true);
		});

		it("returns entries sorted by key", async () => {
			const result = await storage.list();
			const keys = [...result.keys()];
			expect(keys).toEqual([...keys].sort());
		});
	});

	describe("transaction", () => {
		it("executes closure and returns result", async () => {
			await storage.put("count", 0);
			const result = await storage.transaction(async (txn) => {
				const val = await txn.get("count");
				await txn.put("count", (val as number) + 1);
				return "done";
			});
			expect(result).toBe("done");
			expect(await storage.get("count")).toBe(1);
		});

		it("rolls back on error", async () => {
			await storage.put("key", "original");
			await expect(
				storage.transaction(async (txn) => {
					await txn.put("key", "modified");
					throw new Error("rollback");
				}),
			).rejects.toThrow("rollback");
			expect(await storage.get("key")).toBe("original");
		});
	});

	describe("alarms", () => {
		it("getAlarm returns null initially", async () => {
			expect(await storage.getAlarm()).toBeNull();
		});

		it("setAlarm and getAlarm", async () => {
			const time = Date.now() + 60000;
			await storage.setAlarm(time);
			expect(await storage.getAlarm()).toBe(time);
		});

		it("deleteAlarm clears the alarm", async () => {
			await storage.setAlarm(Date.now() + 60000);
			await storage.deleteAlarm();
			expect(await storage.getAlarm()).toBeNull();
		});

		it("setAlarm accepts Date object", async () => {
			const date = new Date(Date.now() + 60000);
			await storage.setAlarm(date);
			expect(await storage.getAlarm()).toBe(date.getTime());
		});
	});
});
