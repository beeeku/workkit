import { describe, expect, it } from "vitest";
import { quota } from "../src";
import { createMockKV } from "./helpers/mock-kv";

describe("quota", () => {
	it("daily quota increments and blocks at limit", async () => {
		const kv = createMockKV();
		const q = quota({ namespace: kv, limits: [{ window: "1d", limit: 3 }] });
		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(false);
	});

	it("returns per-window breakdown in quotas array", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [
				{ window: "1d", limit: 100 },
				{ window: "1h", limit: 10 },
			],
		});
		const result = await q.check("user:1");
		expect(result.quotas).toHaveLength(2);
		expect(result.quotas[0]!.window).toBe("1d");
		expect(result.quotas[1]!.window).toBe("1h");
	});

	it("blocks when any window is exceeded", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [
				{ window: "1d", limit: 100 },
				{ window: "1h", limit: 2 },
			],
		});
		await q.check("user:1");
		await q.check("user:1");
		const result = await q.check("user:1");
		expect(result.allowed).toBe(false);
	});

	it("usage reports without incrementing", async () => {
		const kv = createMockKV();
		const q = quota({ namespace: kv, limits: [{ window: "1d", limit: 10 }] });
		await q.check("user:1");
		await q.check("user:1");
		const usageResult = await q.usage("user:1");
		expect(usageResult).toHaveLength(1);
		expect(usageResult[0]!.used).toBe(2);
		expect(usageResult[0]!.remaining).toBe(8);
	});

	it("cost parameter deducts N from quota", async () => {
		const kv = createMockKV();
		const q = quota({ namespace: kv, limits: [{ window: "1d", limit: 10 }] });
		const result = await q.check("user:1", 5);
		expect(result.allowed).toBe(true);
		expect(result.quotas[0]!.used).toBe(5);
		expect(result.quotas[0]!.remaining).toBe(5);
	});

	it("composable via RateLimiter interface", async () => {
		const kv = createMockKV();
		const q = quota({ namespace: kv, limits: [{ window: "1d", limit: 10 }] });
		const result = await q.check("user:1");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBeDefined();
		expect(result.resetAt).toBeInstanceOf(Date);
		expect(result.limit).toBeDefined();
	});
});
