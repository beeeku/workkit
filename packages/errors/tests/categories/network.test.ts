import { describe, expect, it } from "vitest";
import { WorkkitError } from "../../src/base";
import {
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
} from "../../src/categories/network";

describe("TimeoutError", () => {
	it("formats message with operation + timeout", () => {
		const error = new TimeoutError("KV.get", 5000);
		expect(error.message).toBe("KV.get timed out after 5000ms");
	});

	it("formats message with operation only", () => {
		const error = new TimeoutError("D1.query");
		expect(error.message).toBe("D1.query timed out");
	});

	it("is retryable with exponential backoff", () => {
		const error = new TimeoutError("fetch");
		expect(error.code).toBe("WORKKIT_TIMEOUT");
		expect(error.statusCode).toBe(504);
		expect(error.retryable).toBe(true);
		expect(error.retryStrategy).toEqual({
			kind: "exponential",
			baseMs: 500,
			maxMs: 10000,
			maxAttempts: 3,
		});
	});

	it("includes operation and timeoutMs in context", () => {
		const error = new TimeoutError("KV.get", 5000);
		expect(error.context).toEqual(
			expect.objectContaining({ operation: "KV.get", timeoutMs: 5000 }),
		);
	});
});

describe("RateLimitError", () => {
	it("overrides strategy when retryAfterMs is provided", () => {
		const error = new RateLimitError("Too many requests", 3000);
		expect(error.retryAfterMs).toBe(3000);
		expect(error.retryStrategy).toEqual({
			kind: "fixed",
			delayMs: 3000,
			maxAttempts: 3,
		});
	});

	it("uses default strategy without retryAfterMs", () => {
		const error = new RateLimitError();
		expect(error.retryAfterMs).toBeUndefined();
		expect(error.retryStrategy).toEqual({
			kind: "fixed",
			delayMs: 1000,
			maxAttempts: 3,
		});
	});

	it("has default message", () => {
		const error = new RateLimitError();
		expect(error.message).toBe("Rate limit exceeded");
	});

	it("has correct code and statusCode", () => {
		const error = new RateLimitError();
		expect(error.code).toBe("WORKKIT_RATE_LIMIT");
		expect(error.statusCode).toBe(429);
		expect(error.retryable).toBe(true);
	});
});

describe("ServiceUnavailableError", () => {
	it("includes service name in message", () => {
		const error = new ServiceUnavailableError("KV");
		expect(error.message).toBe("KV is temporarily unavailable");
	});

	it("has aggressive retry strategy (5 attempts)", () => {
		const error = new ServiceUnavailableError("D1");
		expect(error.code).toBe("WORKKIT_SERVICE_UNAVAILABLE");
		expect(error.statusCode).toBe(503);
		expect(error.retryable).toBe(true);
		expect(error.retryStrategy).toEqual({
			kind: "exponential",
			baseMs: 1000,
			maxMs: 30000,
			maxAttempts: 5,
		});
	});

	it("includes service in context", () => {
		const error = new ServiceUnavailableError("R2");
		expect(error.context).toEqual(expect.objectContaining({ service: "R2" }));
	});
});
