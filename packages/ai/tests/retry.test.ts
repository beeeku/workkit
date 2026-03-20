import {
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDelay, defaultIsRetryable, withRetry } from "../src/retry";
import type { AiBinding } from "../src/types";

type CallRecord = { model: string; inputs: Record<string, unknown> };

function createSequenceBinding(
	responses: Array<{ result?: unknown; error?: Error }>,
): AiBinding & { calls: CallRecord[] } {
	let callIndex = 0;
	const calls: CallRecord[] = [];
	return {
		calls,
		async run(model: string, inputs: Record<string, unknown>) {
			calls.push({ model, inputs });
			const entry = responses[callIndex++];
			if (!entry || entry.error) {
				throw entry?.error ?? new Error("Unknown error");
			}
			return entry.result;
		},
	};
}

describe("calculateDelay()", () => {
	it("returns base delay for fixed strategy", () => {
		expect(calculateDelay("fixed", 0, 1000)).toBe(1000);
		expect(calculateDelay("fixed", 1, 1000)).toBe(1000);
		expect(calculateDelay("fixed", 5, 1000)).toBe(1000);
	});

	it("returns linear delay", () => {
		expect(calculateDelay("linear", 0, 1000)).toBe(1000);
		expect(calculateDelay("linear", 1, 1000)).toBe(2000);
		expect(calculateDelay("linear", 2, 1000)).toBe(3000);
		expect(calculateDelay("linear", 4, 1000)).toBe(5000);
	});

	it("returns exponential delay", () => {
		expect(calculateDelay("exponential", 0, 1000)).toBe(1000);
		expect(calculateDelay("exponential", 1, 1000)).toBe(2000);
		expect(calculateDelay("exponential", 2, 1000)).toBe(4000);
		expect(calculateDelay("exponential", 3, 1000)).toBe(8000);
	});

	it("caps delay at maxDelay", () => {
		expect(calculateDelay("exponential", 10, 1000, 5000)).toBe(5000);
		expect(calculateDelay("linear", 100, 1000, 5000)).toBe(5000);
	});

	it("uses default base delay", () => {
		expect(calculateDelay("fixed", 0)).toBe(1000);
	});

	it("uses default max delay", () => {
		// 2^20 * 1000 would be huge, so it's capped at default 30000
		expect(calculateDelay("exponential", 20, 1000)).toBe(30000);
	});
});

describe("defaultIsRetryable()", () => {
	it("returns true for TimeoutError", () => {
		expect(defaultIsRetryable(new TimeoutError("test"))).toBe(true);
	});

	it("returns true for RateLimitError", () => {
		expect(defaultIsRetryable(new RateLimitError())).toBe(true);
	});

	it("returns true for ServiceUnavailableError", () => {
		expect(defaultIsRetryable(new ServiceUnavailableError("AI"))).toBe(true);
	});

	it("returns true for errors with timeout in message", () => {
		expect(defaultIsRetryable(new Error("Request timeout"))).toBe(true);
	});

	it("returns true for errors with rate limit in message", () => {
		expect(defaultIsRetryable(new Error("rate limit exceeded"))).toBe(true);
	});

	it("returns true for errors with unavailable in message", () => {
		expect(defaultIsRetryable(new Error("Service unavailable"))).toBe(true);
	});

	it("returns false for ValidationError", () => {
		expect(defaultIsRetryable(new ValidationError("bad input", []))).toBe(false);
	});

	it("returns false for generic errors", () => {
		expect(defaultIsRetryable(new Error("Something went wrong"))).toBe(false);
	});

	it("returns false for non-error values", () => {
		expect(defaultIsRetryable("string error")).toBe(false);
		expect(defaultIsRetryable(42)).toBe(false);
		expect(defaultIsRetryable(null)).toBe(false);
	});
});

describe("withRetry()", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("binding validation", () => {
		it("throws BindingNotFoundError when binding is null", async () => {
			await expect(withRetry(null as unknown as AiBinding, "model", {})).rejects.toThrow("AI");
		});

		it("throws BindingNotFoundError when binding is undefined", async () => {
			await expect(withRetry(undefined as unknown as AiBinding, "model", {})).rejects.toThrow("AI");
		});
	});

	describe("success on first try", () => {
		it("returns result with 0 retries", async () => {
			const binding = createSequenceBinding([{ result: { response: "OK" } }]);

			const promise = withRetry(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			const result = await promise;

			expect(result.data).toEqual({ response: "OK" });
			expect(result.model).toBe("@cf/meta/llama-3.1-8b-instruct");
			expect(result.retries).toBe(0);
		});

		it("only calls the binding once", async () => {
			const binding = createSequenceBinding([{ result: "ok" }]);

			await withRetry(binding, "model", {});

			expect(binding.calls).toHaveLength(1);
		});
	});

	describe("success after retry", () => {
		it("retries on retryable error and succeeds", async () => {
			const binding = createSequenceBinding([
				{ error: new TimeoutError("test") },
				{ result: { response: "OK after retry" } },
			]);

			const promise = withRetry(
				binding,
				"model",
				{},
				{
					maxRetries: 3,
					backoff: "fixed",
					baseDelay: 100,
				},
			);

			// Advance past the first retry delay
			await vi.advanceTimersByTimeAsync(200);

			const result = await promise;

			expect(result.data).toEqual({ response: "OK after retry" });
			expect(result.retries).toBe(1);
			expect(binding.calls).toHaveLength(2);
		});

		it("retries multiple times before succeeding", async () => {
			const binding = createSequenceBinding([
				{ error: new TimeoutError("test") },
				{ error: new RateLimitError() },
				{ result: { response: "Third time lucky" } },
			]);

			const promise = withRetry(
				binding,
				"model",
				{},
				{
					maxRetries: 3,
					backoff: "fixed",
					baseDelay: 100,
				},
			);

			await vi.advanceTimersByTimeAsync(500);

			const result = await promise;

			expect(result.data).toEqual({ response: "Third time lucky" });
			expect(result.retries).toBe(2);
			expect(binding.calls).toHaveLength(3);
		});
	});

	describe("max retries exceeded", () => {
		it("throws the last error when retries exhausted", async () => {
			vi.useRealTimers();

			const binding = createSequenceBinding([
				{ error: new TimeoutError("attempt 1") },
				{ error: new TimeoutError("attempt 2") },
				{ error: new TimeoutError("attempt 3") },
				{ error: new TimeoutError("attempt 4") },
			]);

			await expect(
				withRetry(
					binding,
					"model",
					{},
					{
						maxRetries: 3,
						backoff: "fixed",
						baseDelay: 1,
					},
				),
			).rejects.toThrow("attempt 4");
		});
	});

	describe("non-retryable errors", () => {
		it("does not retry on non-retryable error", async () => {
			const binding = createSequenceBinding([{ error: new Error("Not retryable") }]);

			await expect(
				withRetry(
					binding,
					"model",
					{},
					{
						maxRetries: 3,
						backoff: "fixed",
						baseDelay: 100,
					},
				),
			).rejects.toThrow("Not retryable");

			expect(binding.calls).toHaveLength(1);
		});
	});

	describe("custom isRetryable", () => {
		it("uses custom isRetryable function", async () => {
			const customError = new Error("CUSTOM_RETRY");
			const binding = createSequenceBinding([
				{ error: customError },
				{ result: { response: "OK" } },
			]);

			const promise = withRetry(
				binding,
				"model",
				{},
				{
					maxRetries: 2,
					backoff: "fixed",
					baseDelay: 50,
					isRetryable: (err) => err instanceof Error && err.message === "CUSTOM_RETRY",
				},
			);

			await vi.advanceTimersByTimeAsync(200);

			const result = await promise;
			expect(result.data).toEqual({ response: "OK" });
			expect(result.retries).toBe(1);
		});
	});

	describe("backoff strategies", () => {
		it("uses exponential backoff by default", async () => {
			const binding = createSequenceBinding([
				{ error: new TimeoutError("1") },
				{ error: new TimeoutError("2") },
				{ result: "ok" },
			]);

			const promise = withRetry(
				binding,
				"model",
				{},
				{
					maxRetries: 3,
					baseDelay: 100,
				},
			);

			// First retry: 100ms (100 * 2^0)
			await vi.advanceTimersByTimeAsync(100);
			expect(binding.calls).toHaveLength(2);

			// Second retry: 200ms (100 * 2^1)
			await vi.advanceTimersByTimeAsync(200);

			await promise;
			expect(binding.calls).toHaveLength(3);
		});
	});

	describe("default options", () => {
		it("uses default maxRetries of 3", async () => {
			vi.useRealTimers();

			const binding = createSequenceBinding([
				{ error: new TimeoutError("1") },
				{ error: new TimeoutError("2") },
				{ error: new TimeoutError("3") },
				{ error: new TimeoutError("4") },
			]);

			await expect(withRetry(binding, "model", {}, { baseDelay: 1 })).rejects.toThrow();

			expect(binding.calls).toHaveLength(4); // 1 initial + 3 retries
		});
	});

	describe("abort signal", () => {
		it("throws immediately when signal is already aborted", async () => {
			const binding = createSequenceBinding([{ result: "ok" }]);
			const controller = new AbortController();
			controller.abort();

			await expect(
				withRetry(binding, "model", {}, { signal: controller.signal }),
			).rejects.toThrow();
		});
	});
});
