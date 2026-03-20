import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitHeaders, rateLimitResponse } from "../src/headers";
import type { RateLimitResult } from "../src/types";

describe("rateLimitHeaders", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns correct header values for allowed request", () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 99,
			resetAt: new Date("2025-01-01T00:01:00.000Z"),
			limit: 100,
		};

		const headers = rateLimitHeaders(result);

		expect(headers["X-RateLimit-Limit"]).toBe("100");
		expect(headers["X-RateLimit-Remaining"]).toBe("99");
		expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(result.resetAt.getTime() / 1000)));
	});

	it("returns correct header values for blocked request", () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date("2025-01-01T00:01:00.000Z"),
			limit: 100,
		};

		const headers = rateLimitHeaders(result);

		expect(headers["X-RateLimit-Limit"]).toBe("100");
		expect(headers["X-RateLimit-Remaining"]).toBe("0");
	});

	it("reset is unix timestamp in seconds", () => {
		const resetAt = new Date("2025-01-01T00:05:00.000Z");
		const result: RateLimitResult = {
			allowed: true,
			remaining: 5,
			resetAt,
			limit: 10,
		};

		const headers = rateLimitHeaders(result);
		expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetAt.getTime() / 1000)));
	});

	it("includes Retry-After for blocked requests", () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 30_000),
			limit: 100,
		};

		const headers = rateLimitHeaders(result);
		expect(headers["Retry-After"]).toBe("30");
	});

	it("does not include Retry-After for allowed requests", () => {
		const result: RateLimitResult = {
			allowed: true,
			remaining: 50,
			resetAt: new Date(Date.now() + 30_000),
			limit: 100,
		};

		const headers = rateLimitHeaders(result);
		expect(headers["Retry-After"]).toBeUndefined();
	});
});

describe("rateLimitResponse", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 429 status", () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 60_000),
			limit: 100,
		};

		const response = rateLimitResponse(result);
		expect(response.status).toBe(429);
	});

	it("includes rate limit headers", () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 60_000),
			limit: 100,
		};

		const response = rateLimitResponse(result);
		expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
		expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
		expect(response.headers.get("Retry-After")).toBe("60");
	});

	it("has JSON content type", async () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 60_000),
			limit: 100,
		};

		const response = rateLimitResponse(result);
		expect(response.headers.get("Content-Type")).toBe("application/json");
	});

	it("body contains error message", async () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 60_000),
			limit: 100,
		};

		const response = rateLimitResponse(result);
		const body = (await response.json()) as any;
		expect(body.error).toBe("Rate limit exceeded");
		expect(body.retryAfter).toBe(60);
	});

	it("accepts custom message", async () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 60_000),
			limit: 100,
		};

		const response = rateLimitResponse(result, "Too many API requests");
		const body = (await response.json()) as any;
		expect(body.error).toBe("Too many API requests");
	});

	it("Retry-After is at least 1 second", () => {
		const result: RateLimitResult = {
			allowed: false,
			remaining: 0,
			resetAt: new Date(Date.now() + 100), // 100ms
			limit: 100,
		};

		const response = rateLimitResponse(result);
		expect(response.headers.get("Retry-After")).toBe("1");
	});
});
