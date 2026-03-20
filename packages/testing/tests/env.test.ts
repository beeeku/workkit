import { describe, expect, it } from "vitest";
import { createTestEnv } from "../src/env";

describe("createTestEnv", () => {
	it("creates KV mocks by name", () => {
		const env = createTestEnv({ kv: ["MY_KV", "CACHE"] });
		expect(env.MY_KV).toBeDefined();
		expect(env.CACHE).toBeDefined();
		// Should have KV methods
		expect(typeof env.MY_KV.get).toBe("function");
		expect(typeof env.MY_KV.put).toBe("function");
		expect(typeof env.MY_KV.delete).toBe("function");
		expect(typeof env.MY_KV.list).toBe("function");
	});

	it("creates D1 mocks by name", () => {
		const env = createTestEnv({ d1: ["DB"] });
		expect(env.DB).toBeDefined();
		expect(typeof env.DB.prepare).toBe("function");
		expect(typeof env.DB.batch).toBe("function");
		expect(typeof env.DB.exec).toBe("function");
	});

	it("creates R2 mocks by name", () => {
		const env = createTestEnv({ r2: ["BUCKET"] });
		expect(env.BUCKET).toBeDefined();
		expect(typeof env.BUCKET.get).toBe("function");
		expect(typeof env.BUCKET.put).toBe("function");
		expect(typeof env.BUCKET.delete).toBe("function");
		expect(typeof env.BUCKET.list).toBe("function");
	});

	it("creates Queue mocks by name", () => {
		const env = createTestEnv({ queue: ["EVENTS"] });
		expect(env.EVENTS).toBeDefined();
		expect(typeof env.EVENTS.send).toBe("function");
		expect(typeof env.EVENTS.sendBatch).toBe("function");
	});

	it("creates DO mocks by name", () => {
		const env = createTestEnv({ do: ["COUNTER"] });
		expect(env.COUNTER).toBeDefined();
		expect(typeof env.COUNTER.get).toBe("function");
		expect(typeof env.COUNTER.put).toBe("function");
		expect(typeof env.COUNTER.delete).toBe("function");
		expect(typeof env.COUNTER.list).toBe("function");
	});

	it("includes plain vars", () => {
		const env = createTestEnv({ vars: { API_KEY: "test-key", SECRET: "123" } });
		expect(env.API_KEY).toBe("test-key");
		expect(env.SECRET).toBe("123");
	});

	it("creates a mixed environment", () => {
		const env = createTestEnv({
			kv: ["CACHE"],
			d1: ["DB"],
			r2: ["ASSETS"],
			queue: ["EVENTS"],
			do: ["STATE"],
			vars: { ENV: "test" },
		});
		expect(typeof env.CACHE.get).toBe("function");
		expect(typeof env.DB.prepare).toBe("function");
		expect(typeof env.ASSETS.put).toBe("function");
		expect(typeof env.EVENTS.send).toBe("function");
		expect(typeof env.STATE.get).toBe("function");
		expect(env.ENV).toBe("test");
	});

	it("returns empty object with no config", () => {
		const env = createTestEnv({});
		expect(Object.keys(env)).toHaveLength(0);
	});

	it("KV mocks in env are functional", async () => {
		const env = createTestEnv({ kv: ["KV"] });
		await env.KV.put("key", "value");
		expect(await env.KV.get("key")).toBe("value");
	});

	it("D1 mocks in env are functional", async () => {
		const env = createTestEnv({ d1: ["DB"] });
		await env.DB.exec("CREATE TABLE t (id INTEGER)");
		const result = await env.DB.prepare("INSERT INTO t (id) VALUES (?)").bind(1).run();
		expect(result.success).toBe(true);
	});
});
