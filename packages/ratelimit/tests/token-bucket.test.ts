import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenBucket } from "../src/token-bucket";
import { createMockKV } from "./helpers/mock-kv";

describe("tokenBucket", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows consuming a single token", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});
		const result = await limiter.consume("user:1");

		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(9);
		expect(result.limit).toBe(10);
	});

	it("defaults to consuming 1 token", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});

		const r1 = await limiter.consume("user:1");
		expect(r1.remaining).toBe(9);

		const r2 = await limiter.consume("user:1");
		expect(r2.remaining).toBe(8);
	});

	it("consumes multiple tokens at once", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});

		const result = await limiter.consume("user:1", 5);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(5);
	});

	it("allows burst consumption up to capacity", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});

		const result = await limiter.consume("user:1", 10);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(0);
	});

	it("blocks when not enough tokens", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 5,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 5);

		const result = await limiter.consume("user:1", 1);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it("blocks when requesting more than available", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 8);

		const result = await limiter.consume("user:1", 5);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(2);
	});

	it("does not consume tokens when blocked", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 5,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 3);

		// Try to consume 5 — should fail (only 2 remaining)
		const blocked = await limiter.consume("user:1", 5);
		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(2);

		// Should still have 2 tokens since the failed consume didn't deduct
		const result = await limiter.consume("user:1", 2);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(0);
	});

	it("refills tokens over time", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 10);

		// Advance 3 seconds — should refill 3 tokens
		vi.advanceTimersByTime(3_000);

		const result = await limiter.consume("user:1", 1);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(2);
	});

	it("does not refill beyond capacity", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 5,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 2);

		// Advance 100 seconds — should refill at most to capacity
		vi.advanceTimersByTime(100_000);

		const result = await limiter.consume("user:1", 1);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(4); // capacity - 1
	});

	it("tracks different keys independently", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 5,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 5);

		const r1 = await limiter.consume("user:1", 1);
		expect(r1.allowed).toBe(false);

		const r2 = await limiter.consume("user:2", 1);
		expect(r2.allowed).toBe(true);
		expect(r2.remaining).toBe(4);
	});

	it("handles refill rate greater than 1", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 100,
			refillRate: 10,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 100);

		// Advance 3 seconds — should refill 30 tokens
		vi.advanceTimersByTime(3_000);

		const result = await limiter.consume("user:1", 1);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(29);
	});

	it("uses custom prefix for KV keys", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
			prefix: "bucket:",
		});
		await limiter.consume("user:1");

		const keys = [...kv._store.keys()];
		expect(keys.some((k) => k.startsWith("bucket:"))).toBe(true);
	});

	it("sets correct resetAt timestamp", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 10,
			refillRate: 1,
			refillInterval: "1s",
		});
		const result = await limiter.consume("user:1");

		expect(result.resetAt).toBeInstanceOf(Date);
	});

	it("handles capacity of 1", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 1,
			refillRate: 1,
			refillInterval: "1s",
		});

		const r1 = await limiter.consume("user:1");
		expect(r1.allowed).toBe(true);
		expect(r1.remaining).toBe(0);

		const r2 = await limiter.consume("user:1");
		expect(r2.allowed).toBe(false);

		vi.advanceTimersByTime(1_000);

		const r3 = await limiter.consume("user:1");
		expect(r3.allowed).toBe(true);
	});

	it("remaining never goes below zero", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 3,
			refillRate: 1,
			refillInterval: "1s",
		});

		await limiter.consume("user:1", 3);

		const r = await limiter.consume("user:1", 1);
		expect(r.remaining).toBe(0);

		const r2 = await limiter.consume("user:1", 10);
		expect(r2.remaining).toBe(0);
	});

	it("blocks when requesting more tokens than capacity", async () => {
		const limiter = tokenBucket({
			namespace: kv,
			capacity: 5,
			refillRate: 1,
			refillInterval: "1s",
		});

		const result = await limiter.consume("user:1", 6);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(5);
	});
});
