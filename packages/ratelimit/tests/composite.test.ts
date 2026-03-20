import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composite } from "../src/composite";
import { fixedWindow } from "../src/fixed-window";
import { slidingWindow } from "../src/sliding-window";
import { createMockKV } from "./helpers/mock-kv";

describe("composite", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows when all limiters allow", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 100, window: "1m" }),
			fixedWindow({ namespace: kv, limit: 1000, window: "1h" }),
		]);

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(true);
	});

	it("blocks when any limiter blocks", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 2, window: "1m" }),
			fixedWindow({ namespace: kv, limit: 1000, window: "1h" }),
		]);

		await limiter.check("user:1");
		await limiter.check("user:1");

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(false);
	});

	it("returns the most restrictive remaining", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 10, window: "1m", prefix: "a:" }),
			fixedWindow({ namespace: kv, limit: 5, window: "1h", prefix: "b:" }),
		]);

		const result = await limiter.check("user:1");
		// The 5-limit limiter is more restrictive (remaining 4 < remaining 9)
		expect(result.remaining).toBe(4);
		expect(result.limit).toBe(5);
	});

	it("returns the earliest resetAt", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 10, window: "1m", prefix: "a:" }),
			fixedWindow({ namespace: kv, limit: 10, window: "1h", prefix: "b:" }),
		]);

		const result = await limiter.check("user:1");

		// The 1-minute window resets sooner than the 1-hour window
		const oneMinuteReset = new Date(Date.now() + 60_000);
		expect(result.resetAt.getTime()).toBe(oneMinuteReset.getTime());
	});

	it("checks all limiters even when first blocks", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 1, window: "1m", prefix: "a:" }),
			fixedWindow({ namespace: kv, limit: 100, window: "1h", prefix: "b:" }),
		]);

		await limiter.check("user:1");

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(false);
		// Both limiters should have been checked (count incremented in both)
	});

	it("works with mixed limiter types", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 10, window: "1m", prefix: "fixed:" }),
			slidingWindow({ namespace: kv, limit: 100, window: "1h", prefix: "sliding:" }),
		]);

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(true);
	});

	it("tracks different keys independently", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 1, window: "1m", prefix: "a:" }),
		]);

		await limiter.check("user:1");

		const r1 = await limiter.check("user:1");
		expect(r1.allowed).toBe(false);

		const r2 = await limiter.check("user:2");
		expect(r2.allowed).toBe(true);
	});

	it("handles single limiter", async () => {
		const limiter = composite([fixedWindow({ namespace: kv, limit: 5, window: "1m" })]);

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(4);
	});

	it("returns blocked result with most restrictive details", async () => {
		const limiter = composite([
			fixedWindow({ namespace: kv, limit: 2, window: "1m", prefix: "a:" }),
			fixedWindow({ namespace: kv, limit: 3, window: "1h", prefix: "b:" }),
		]);

		await limiter.check("user:1");
		await limiter.check("user:1");

		const result = await limiter.check("user:1");
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
		// limit should match the blocked limiter
		expect(result.limit).toBe(2);
	});
});
