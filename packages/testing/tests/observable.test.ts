import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../src/d1";
import { createMockDO } from "../src/do";
import { createMockKV } from "../src/kv";
import type { MockOperations } from "../src/observable";
import { createMockQueue } from "../src/queue";
import { createMockR2 } from "../src/r2";

describe("Observable Mocks", () => {
	describe("KV operations tracking", () => {
		let kv: ReturnType<typeof createMockKV>;

		beforeEach(() => {
			kv = createMockKV();
		});

		it("tracks get as read", async () => {
			await kv.put("key", "value");
			(kv as unknown as MockOperations).reset();
			await kv.get("key");
			const ops = (kv as unknown as MockOperations).operations;
			expect(ops).toHaveLength(1);
			expect(ops[0].type).toBe("read");
			expect(ops[0].key).toBe("key");
			expect(ops[0].timestamp).toBeTypeOf("number");
		});

		it("tracks put as write", async () => {
			await kv.put("key", "value");
			const writes = (kv as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
			expect(writes[0].key).toBe("key");
		});

		it("tracks delete as delete", async () => {
			await kv.delete("key");
			const deletes = (kv as unknown as MockOperations).deletes();
			expect(deletes).toHaveLength(1);
			expect(deletes[0].key).toBe("key");
		});

		it("tracks list as list", async () => {
			await kv.list();
			const ops = (kv as unknown as MockOperations).operations;
			expect(ops).toHaveLength(1);
			expect(ops[0].type).toBe("list");
		});

		it("tracks getWithMetadata as read", async () => {
			await kv.put("key", "value");
			(kv as unknown as MockOperations).reset();
			await kv.getWithMetadata("key");
			const reads = (kv as unknown as MockOperations).reads();
			expect(reads).toHaveLength(1);
			expect(reads[0].key).toBe("key");
		});

		it("reset() clears all operations", async () => {
			await kv.put("a", "1");
			await kv.get("a");
			await kv.delete("a");
			expect((kv as unknown as MockOperations).operations.length).toBeGreaterThan(0);
			(kv as unknown as MockOperations).reset();
			expect((kv as unknown as MockOperations).operations).toHaveLength(0);
		});
	});

	describe("D1 operations tracking", () => {
		let db: ReturnType<typeof createMockD1>;

		beforeEach(() => {
			db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
		});

		it("tracks SELECT as read", async () => {
			await db.prepare("SELECT * FROM users").all();
			const reads = (db as unknown as MockOperations).reads();
			expect(reads).toHaveLength(1);
			expect(reads[0].type).toBe("read");
		});

		it("tracks INSERT as write", async () => {
			await db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind(2, "Bob").run();
			const writes = (db as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
		});

		it("tracks UPDATE as write", async () => {
			await db.prepare("UPDATE users SET name = ? WHERE id = ?").bind("Alicia", 1).run();
			const writes = (db as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
		});

		it("tracks DELETE as delete", async () => {
			await db.prepare("DELETE FROM users WHERE id = ?").bind(1).run();
			const deletes = (db as unknown as MockOperations).deletes();
			expect(deletes).toHaveLength(1);
		});

		it("reset() clears all operations", async () => {
			await db.prepare("SELECT * FROM users").all();
			await db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind(2, "Bob").run();
			(db as unknown as MockOperations).reset();
			expect((db as unknown as MockOperations).operations).toHaveLength(0);
		});
	});

	describe("R2 operations tracking", () => {
		let r2: ReturnType<typeof createMockR2>;

		beforeEach(() => {
			r2 = createMockR2();
		});

		it("tracks get as read", async () => {
			await r2.get("file.txt");
			const reads = (r2 as unknown as MockOperations).reads();
			expect(reads).toHaveLength(1);
			expect(reads[0].key).toBe("file.txt");
		});

		it("tracks head as read", async () => {
			await r2.head("file.txt");
			const reads = (r2 as unknown as MockOperations).reads();
			expect(reads).toHaveLength(1);
			expect(reads[0].key).toBe("file.txt");
		});

		it("tracks put as write", async () => {
			await r2.put("file.txt", "content");
			const writes = (r2 as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
			expect(writes[0].key).toBe("file.txt");
		});

		it("tracks delete as delete", async () => {
			await r2.delete("file.txt");
			const deletes = (r2 as unknown as MockOperations).deletes();
			expect(deletes).toHaveLength(1);
			expect(deletes[0].key).toBe("file.txt");
		});

		it("tracks list as list", async () => {
			await r2.list();
			const ops = (r2 as unknown as MockOperations).operations;
			expect(ops).toHaveLength(1);
			expect(ops[0].type).toBe("list");
		});

		it("reset() clears all operations", async () => {
			await r2.put("a", "1");
			await r2.get("a");
			(r2 as unknown as MockOperations).reset();
			expect((r2 as unknown as MockOperations).operations).toHaveLength(0);
		});
	});

	describe("Queue operations tracking", () => {
		let queue: ReturnType<typeof createMockQueue>;

		beforeEach(() => {
			queue = createMockQueue();
		});

		it("tracks send as write", async () => {
			await queue.send({ event: "test" });
			const writes = (queue as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
		});

		it("tracks sendBatch as write", async () => {
			await queue.sendBatch([{ body: "a" }, { body: "b" }]);
			const writes = (queue as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
		});

		it("reset() clears all operations", async () => {
			await queue.send("msg");
			(queue as unknown as MockOperations).reset();
			expect((queue as unknown as MockOperations).operations).toHaveLength(0);
		});
	});

	describe("DO operations tracking", () => {
		let doStorage: ReturnType<typeof createMockDO>;

		beforeEach(() => {
			doStorage = createMockDO();
		});

		it("tracks get as read", async () => {
			await doStorage.get("key");
			const reads = (doStorage as unknown as MockOperations).reads();
			expect(reads).toHaveLength(1);
			expect(reads[0].key).toBe("key");
		});

		it("tracks put as write", async () => {
			await doStorage.put("key", "value");
			const writes = (doStorage as unknown as MockOperations).writes();
			expect(writes).toHaveLength(1);
			expect(writes[0].key).toBe("key");
		});

		it("tracks delete as delete", async () => {
			await doStorage.delete("key");
			const deletes = (doStorage as unknown as MockOperations).deletes();
			expect(deletes).toHaveLength(1);
			expect(deletes[0].key).toBe("key");
		});

		it("tracks list as list", async () => {
			await doStorage.list();
			const ops = (doStorage as unknown as MockOperations).operations;
			expect(ops).toHaveLength(1);
			expect(ops[0].type).toBe("list");
		});

		it("reset() clears all operations", async () => {
			await doStorage.put("a", 1);
			await doStorage.get("a");
			await doStorage.delete("a");
			(doStorage as unknown as MockOperations).reset();
			expect((doStorage as unknown as MockOperations).operations).toHaveLength(0);
		});
	});
});
