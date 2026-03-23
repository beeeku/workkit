import { beforeEach, describe, expect, it } from "vitest";
import { createMockKV } from "../src/kv";
import { createMockD1 } from "../src/d1";
import { createMockR2 } from "../src/r2";
import { createMockQueue } from "../src/queue";
import { createMockDO } from "../src/do";
import type { ErrorInjection } from "../src/error-injection";

describe("Error Injection", () => {
	describe("failAfter", () => {
		it("first N operations succeed, then throws", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).failAfter(3);

			await kv.put("a", "1"); // 1
			await kv.put("b", "2"); // 2
			await kv.put("c", "3"); // 3
			await expect(kv.get("a")).rejects.toThrow(); // 4 — fails
		});

		it("uses custom error message", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).failAfter(1, new Error("KV overloaded"));

			await kv.put("a", "1"); // 1
			await expect(kv.get("a")).rejects.toThrow("KV overloaded");
		});
	});

	describe("failOn", () => {
		it("matching keys fail, others succeed", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).failOn(/^user:/);

			await kv.put("config", "ok"); // succeeds — no match
			await expect(kv.get("user:1")).rejects.toThrow(); // fails — matches
		});

		it("uses custom error for pattern match", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).failOn(/secret/, new Error("Access denied"));

			await expect(kv.get("secret-key")).rejects.toThrow("Access denied");
		});
	});

	describe("withLatency", () => {
		it("operations take at least minMs", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).withLatency(10, 50);

			await kv.put("key", "val");
			const start = Date.now();
			await kv.get("key");
			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThanOrEqual(9); // small tolerance
		});
	});

	describe("clearInjections", () => {
		it("resets all injections", async () => {
			const kv = createMockKV();
			(kv as unknown as ErrorInjection).failAfter(1);
			(kv as unknown as ErrorInjection).failOn(/test/);

			(kv as unknown as ErrorInjection).clearInjections();

			// Should all succeed now
			await kv.put("test", "value");
			await kv.get("test");
			await kv.put("test2", "value");
		});
	});

	describe("works on D1", () => {
		it("failAfter works on D1", async () => {
			const db = createMockD1({ users: [{ id: 1, name: "Alice" }] });
			(db as unknown as ErrorInjection).failAfter(1);

			await db.prepare("SELECT * FROM users").all(); // 1 — succeeds
			await expect(db.prepare("SELECT * FROM users").all()).rejects.toThrow(); // 2 — fails
		});
	});

	describe("works on R2", () => {
		it("failAfter works on R2", async () => {
			const r2 = createMockR2();
			(r2 as unknown as ErrorInjection).failAfter(1);

			await r2.put("file.txt", "content"); // 1
			await expect(r2.get("file.txt")).rejects.toThrow(); // 2
		});

		it("failOn works on R2", async () => {
			const r2 = createMockR2();
			(r2 as unknown as ErrorInjection).failOn(/\.secret$/);

			await r2.put("file.txt", "ok"); // succeeds
			await expect(r2.get("file.secret")).rejects.toThrow(); // fails
		});
	});

	describe("works on Queue", () => {
		it("failAfter works on Queue", async () => {
			const queue = createMockQueue();
			(queue as unknown as ErrorInjection).failAfter(1);

			await queue.send("msg1"); // 1
			await expect(queue.send("msg2")).rejects.toThrow(); // 2
		});
	});

	describe("works on DO", () => {
		it("failAfter works on DO", async () => {
			const doStorage = createMockDO();
			(doStorage as unknown as ErrorInjection).failAfter(2);

			await doStorage.put("a", 1); // 1
			await doStorage.get("a"); // 2
			await expect(doStorage.put("b", 2)).rejects.toThrow(); // 3
		});

		it("failOn works on DO", async () => {
			const doStorage = createMockDO();
			(doStorage as unknown as ErrorInjection).failOn(/^private:/);

			await doStorage.put("public:1", "ok"); // succeeds
			await expect(doStorage.get("private:secret")).rejects.toThrow(); // fails
		});
	});
});
