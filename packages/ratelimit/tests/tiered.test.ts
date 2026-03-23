import { describe, expect, it, vi } from "vitest";
import { tiered } from "../src";
import { createMockKV } from "./helpers/mock-kv";

describe("tiered", () => {
	it("free tier hits limit while pro is still allowed", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 2 }, pro: { limit: 100 } },
			window: "1m",
		});
		await limiter.check("user:1", "free");
		await limiter.check("user:1", "free");
		const result = await limiter.check("user:1", "free");
		expect(result.allowed).toBe(false);
		const proResult = await limiter.check("user:2", "pro");
		expect(proResult.allowed).toBe(true);
	});

	it("Infinity tier always allows without KV access", async () => {
		const kv = createMockKV();
		const spy = vi.spyOn(kv, "get");
		const limiter = tiered({
			namespace: kv,
			tiers: { enterprise: { limit: Number.POSITIVE_INFINITY } },
			window: "1h",
		});
		const result = await limiter.check("user:1", "enterprise");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
		expect(spy).not.toHaveBeenCalled();
	});

	it("unknown tier uses defaultTier", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 5 } },
			window: "1m",
			defaultTier: "free",
		});
		const result = await limiter.check("user:1", "unknown-tier");
		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(5);
	});

	it("unknown tier without default throws", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 5 } },
			window: "1m",
		});
		await expect(limiter.check("user:1", "unknown")).rejects.toThrow();
	});

	it("forTier returns a RateLimiter with single-arg check", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 10 } },
			window: "1m",
		});
		const freeLimiter = limiter.forTier("free");
		const result = await freeLimiter.check("user:1");
		expect(result.allowed).toBe(true);
	});

	it("different keys tracked independently per tier", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 1 } },
			window: "1m",
		});
		const r1 = await limiter.check("user:1", "free");
		const r2 = await limiter.check("user:2", "free");
		expect(r1.allowed).toBe(true);
		expect(r2.allowed).toBe(true);
	});
});
