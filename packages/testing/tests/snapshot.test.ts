import { describe, expect, it } from "vitest";
import { createMockD1 } from "../src/d1";
import { createMockDO } from "../src/do";
import { createMockKV } from "../src/kv";
import { createMockQueue } from "../src/queue";
import { createMockR2 } from "../src/r2";
import { snapshotEnv } from "../src/snapshot";

describe("snapshotEnv", () => {
	it("detects KV bindings", async () => {
		const kv = createMockKV();
		await kv.put("a", "1");
		await kv.put("b", "2");
		const snap = snapshotEnv({ MY_KV: kv });
		expect(snap.bindings.MY_KV).toEqual({ type: "kv", count: 2 });
	});

	it("detects D1 bindings", () => {
		const db = createMockD1({ users: [{ id: 1 }, { id: 2 }] });
		const snap = snapshotEnv({ DB: db });
		expect(snap.bindings.DB.type).toBe("d1");
	});

	it("detects R2 bindings", async () => {
		const r2 = createMockR2();
		await r2.put("file.txt", "content");
		const snap = snapshotEnv({ BUCKET: r2 });
		expect(snap.bindings.BUCKET).toEqual({ type: "r2", count: 1 });
	});

	it("detects Queue bindings", async () => {
		const queue = createMockQueue();
		await queue.send("msg1");
		await queue.send("msg2");
		const snap = snapshotEnv({ EVENTS: queue });
		expect(snap.bindings.EVENTS).toEqual({ type: "queue", count: 2 });
	});

	it("detects DO bindings", async () => {
		const doStorage = createMockDO();
		await doStorage.put("key", "value");
		const snap = snapshotEnv({ STATE: doStorage });
		expect(snap.bindings.STATE).toEqual({ type: "do", count: 1 });
	});

	it("detects plain vars", () => {
		const snap = snapshotEnv({ API_URL: "http://localhost", DEBUG: true });
		expect(snap.bindings.API_URL).toEqual({ type: "var", value: "http://localhost" });
		expect(snap.bindings.DEBUG).toEqual({ type: "var", value: true });
	});

	it("handles mixed environment", async () => {
		const kv = createMockKV();
		await kv.put("x", "1");
		const db = createMockD1();
		const r2 = createMockR2();
		const queue = createMockQueue();
		const doStorage = createMockDO();

		const snap = snapshotEnv({
			CACHE: kv,
			DB: db,
			ASSETS: r2,
			EVENTS: queue,
			STATE: doStorage,
			ENV: "test",
		});

		expect(snap.bindings.CACHE.type).toBe("kv");
		expect(snap.bindings.DB.type).toBe("d1");
		expect(snap.bindings.ASSETS.type).toBe("r2");
		expect(snap.bindings.EVENTS.type).toBe("queue");
		expect(snap.bindings.STATE.type).toBe("do");
		expect(snap.bindings.ENV).toEqual({ type: "var", value: "test" });
	});

	it("returns summary counts", async () => {
		const kv = createMockKV();
		const queue = createMockQueue();

		const snap = snapshotEnv({ KV: kv, Q: queue, X: "hello" });
		expect(snap.summary.kv).toBe(1);
		expect(snap.summary.queue).toBe(1);
		expect(snap.summary.var).toBe(1);
		expect(snap.summary.d1).toBe(0);
		expect(snap.summary.r2).toBe(0);
		expect(snap.summary.do).toBe(0);
	});

	it("handles empty environment", () => {
		const snap = snapshotEnv({});
		expect(Object.keys(snap.bindings)).toHaveLength(0);
		expect(snap.summary.kv).toBe(0);
	});
});
