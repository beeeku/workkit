import { describe, expectTypeOf, it } from "vitest";
import type {
	CompositeRateLimiter,
	Duration,
	FixedWindowOptions,
	RateLimitResult,
	RateLimiter,
	SlidingWindowOptions,
	TokenBucketOptions,
	TokenRateLimiter,
} from "../src/types";

describe("type definitions", () => {
	it("RateLimitResult has correct shape", () => {
		expectTypeOf<RateLimitResult>().toHaveProperty("allowed");
		expectTypeOf<RateLimitResult["allowed"]>().toEqualTypeOf<boolean>();
		expectTypeOf<RateLimitResult>().toHaveProperty("remaining");
		expectTypeOf<RateLimitResult["remaining"]>().toEqualTypeOf<number>();
		expectTypeOf<RateLimitResult>().toHaveProperty("resetAt");
		expectTypeOf<RateLimitResult["resetAt"]>().toEqualTypeOf<Date>();
		expectTypeOf<RateLimitResult>().toHaveProperty("limit");
		expectTypeOf<RateLimitResult["limit"]>().toEqualTypeOf<number>();
	});

	it("Duration accepts valid format", () => {
		expectTypeOf<"1s">().toMatchTypeOf<Duration>();
		expectTypeOf<"5m">().toMatchTypeOf<Duration>();
		expectTypeOf<"1h">().toMatchTypeOf<Duration>();
		expectTypeOf<"1d">().toMatchTypeOf<Duration>();
	});

	it("FixedWindowOptions has required fields", () => {
		expectTypeOf<FixedWindowOptions>().toHaveProperty("namespace");
		expectTypeOf<FixedWindowOptions>().toHaveProperty("limit");
		expectTypeOf<FixedWindowOptions>().toHaveProperty("window");
	});

	it("SlidingWindowOptions has required fields", () => {
		expectTypeOf<SlidingWindowOptions>().toHaveProperty("namespace");
		expectTypeOf<SlidingWindowOptions>().toHaveProperty("limit");
		expectTypeOf<SlidingWindowOptions>().toHaveProperty("window");
	});

	it("TokenBucketOptions has required fields", () => {
		expectTypeOf<TokenBucketOptions>().toHaveProperty("namespace");
		expectTypeOf<TokenBucketOptions>().toHaveProperty("capacity");
		expectTypeOf<TokenBucketOptions>().toHaveProperty("refillRate");
		expectTypeOf<TokenBucketOptions>().toHaveProperty("refillInterval");
	});

	it("RateLimiter has check method", () => {
		expectTypeOf<RateLimiter>().toHaveProperty("check");
		expectTypeOf<RateLimiter["check"]>().toEqualTypeOf<(key: string) => Promise<RateLimitResult>>();
	});

	it("TokenRateLimiter has consume method", () => {
		expectTypeOf<TokenRateLimiter>().toHaveProperty("consume");
	});

	it("CompositeRateLimiter has check method", () => {
		expectTypeOf<CompositeRateLimiter>().toHaveProperty("check");
		expectTypeOf<CompositeRateLimiter["check"]>().toEqualTypeOf<
			(key: string) => Promise<RateLimitResult>
		>();
	});
});
