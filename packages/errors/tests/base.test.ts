import { describe, expect, it } from "vitest";
import { WorkkitError } from "../src/base";
import type { RetryStrategy, SerializedError, WorkkitErrorCode } from "../src/types";

// Concrete subclass for testing the abstract base
class TestError extends WorkkitError {
	readonly code = "WORKKIT_INTERNAL" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };
}

class RetryableTestError extends WorkkitError {
	readonly code = "WORKKIT_TIMEOUT" as const;
	readonly statusCode = 504;
	readonly retryable = true;
	readonly defaultRetryStrategy: RetryStrategy = {
		kind: "exponential",
		baseMs: 500,
		maxMs: 10000,
		maxAttempts: 3,
	};
}

describe("WorkkitError", () => {
	it("extends native Error", () => {
		const error = new TestError("test");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(WorkkitError);
	});

	it("sets name to constructor name", () => {
		const error = new TestError("test");
		expect(error.name).toBe("TestError");
	});

	it("prototype chain works for instanceof", () => {
		const error = new TestError("test");
		expect(error instanceof TestError).toBe(true);
		expect(error instanceof WorkkitError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});

	it("preserves cause from options", () => {
		const cause = new Error("root cause");
		const error = new TestError("wrapper", { cause });
		expect(error.cause).toBe(cause);
	});

	it("attaches context", () => {
		const ctx = { key: "user:123", table: "users" };
		const error = new TestError("test", { context: ctx });
		expect(error.context).toEqual(ctx);
	});

	it("sets timestamp on construction", () => {
		const before = new Date();
		const error = new TestError("test");
		const after = new Date();
		expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
	});

	it("retryStrategy returns override when provided", () => {
		const override: RetryStrategy = { kind: "fixed", delayMs: 2000, maxAttempts: 5 };
		const error = new RetryableTestError("test", { retryStrategy: override });
		expect(error.retryStrategy).toEqual(override);
	});

	it("retryStrategy returns default when no override", () => {
		const error = new RetryableTestError("test");
		expect(error.retryStrategy).toEqual({
			kind: "exponential",
			baseMs: 500,
			maxMs: 10000,
			maxAttempts: 3,
		});
	});

	describe("toJSON()", () => {
		it("produces correct SerializedError shape", () => {
			const error = new TestError("something broke", {
				context: { service: "kv" },
			});
			const json = error.toJSON();

			expect(json.name).toBe("TestError");
			expect(json.code).toBe("WORKKIT_INTERNAL");
			expect(json.message).toBe("something broke");
			expect(json.statusCode).toBe(500);
			expect(json.retryable).toBe(false);
			expect(json.retryStrategy).toEqual({ kind: "none" });
			expect(json.context).toEqual({ service: "kv" });
			expect(typeof json.timestamp).toBe("string");
			expect(new Date(json.timestamp).getTime()).not.toBeNaN();
		});

		it("recursively serializes WorkkitError causes", () => {
			const rootCause = new TestError("root");
			const error = new TestError("wrapper", { cause: rootCause });
			const json = error.toJSON();

			expect(json.cause).toBeDefined();
			const cause = json.cause as SerializedError;
			expect(cause.code).toBe("WORKKIT_INTERNAL");
			expect(cause.message).toBe("root");
		});

		it("serializes native Error causes (name + message only)", () => {
			const cause = new TypeError("bad type");
			const error = new TestError("wrapper", { cause });
			const json = error.toJSON();

			expect(json.cause).toEqual({ name: "TypeError", message: "bad type" });
		});

		it("omits empty context", () => {
			const error = new TestError("test");
			const json = error.toJSON();
			expect(json.context).toBeUndefined();
		});

		it("omits context when context object is empty", () => {
			const error = new TestError("test", { context: {} });
			const json = error.toJSON();
			expect(json.context).toBeUndefined();
		});
	});

	describe("toString()", () => {
		it("includes code prefix, name, message", () => {
			const error = new TestError("something broke");
			expect(error.toString()).toBe("[WORKKIT_INTERNAL] TestError: something broke");
		});

		it("includes context when present", () => {
			const error = new TestError("fail", { context: { key: "abc" } });
			const str = error.toString();
			expect(str).toContain('context: {"key":"abc"}');
		});

		it("includes cause message when present", () => {
			const cause = new Error("root");
			const error = new TestError("wrapper", { cause });
			const str = error.toString();
			expect(str).toContain("caused by: root");
		});
	});
});
