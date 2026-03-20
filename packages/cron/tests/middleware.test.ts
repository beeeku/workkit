import { TimeoutError } from "@workkit/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withErrorReporting, withRetry, withTimeout } from "../src/middleware";
import { createMockCtx, createMockEvent } from "./helpers/mock";

type TestEnv = { ERROR_QUEUE: string };

describe("withTimeout()", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns a middleware function", () => {
		const mw = withTimeout(1000);
		expect(typeof mw).toBe("function");
	});

	it("allows fast handlers to complete", async () => {
		vi.useRealTimers();
		const mw = withTimeout(1000);
		const spy = vi.fn();
		const wrapped = mw(spy, "test");

		await wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx());
		expect(spy).toHaveBeenCalledOnce();
	});

	it("throws TimeoutError when handler exceeds timeout", async () => {
		vi.useRealTimers();
		const mw = withTimeout(50);
		const slowHandler = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 5000));
		});
		const wrapped = mw(slowHandler, "slow-task");

		await expect(
			wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx()),
		).rejects.toThrow(TimeoutError);
	});

	it("includes task name in TimeoutError message", async () => {
		vi.useRealTimers();
		const mw = withTimeout(50);
		const slowHandler = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 5000));
		});
		const wrapped = mw(slowHandler, "my-slow-task");

		await expect(
			wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx()),
		).rejects.toThrow(/my-slow-task/);
	});

	it("does not interfere with handler errors", async () => {
		vi.useRealTimers();
		const mw = withTimeout(5000);
		const failHandler = vi.fn(async () => {
			throw new Error("handler error");
		});
		const wrapped = mw(failHandler, "test");

		await expect(
			wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx()),
		).rejects.toThrow("handler error");
	});
});

describe("withRetry()", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns a middleware function", () => {
		const mw = withRetry(3);
		expect(typeof mw).toBe("function");
	});

	it("does not retry on success", async () => {
		vi.useRealTimers();
		const mw = withRetry(3);
		const spy = vi.fn();
		const wrapped = mw(spy, "test");

		await wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx());
		expect(spy).toHaveBeenCalledOnce();
	});

	it("retries on failure up to maxRetries", async () => {
		vi.useRealTimers();
		const mw = withRetry(2, { baseDelay: 10, exponential: false });
		const spy = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockRejectedValueOnce(new Error("fail 3"));

		const wrapped = mw(spy, "test");

		await expect(
			wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx()),
		).rejects.toThrow("fail 3");
		expect(spy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
	});

	it("succeeds after retries", async () => {
		vi.useRealTimers();
		const mw = withRetry(3, { baseDelay: 10, exponential: false });
		const spy = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValueOnce(undefined);

		const wrapped = mw(spy, "test");

		await expect(
			wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx()),
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("uses exponential backoff by default", async () => {
		vi.useRealTimers();
		const mw = withRetry(2, { baseDelay: 10 });
		const callTimes: number[] = [];
		const spy = vi.fn(async () => {
			callTimes.push(Date.now());
			if (callTimes.length < 3) throw new Error("fail");
		});

		const wrapped = mw(spy, "test");
		await wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx());

		expect(spy).toHaveBeenCalledTimes(3);
		// Second delay should be longer than first (exponential)
		const delay1 = callTimes[1] - callTimes[0];
		const delay2 = callTimes[2] - callTimes[1];
		expect(delay2).toBeGreaterThanOrEqual(delay1);
	});
});

describe("withErrorReporting()", () => {
	it("returns a middleware function", () => {
		const mw = withErrorReporting(() => "queue");
		expect(typeof mw).toBe("function");
	});

	it("does not report on success", async () => {
		const reporter = vi.fn();
		const mw = withErrorReporting(() => "queue", reporter);
		const wrapped = mw(vi.fn(), "test");

		await wrapped(createMockEvent("0 * * * *"), {} as TestEnv, createMockCtx());
		expect(reporter).not.toHaveBeenCalled();
	});

	it("reports errors and rethrows", async () => {
		const reporter = vi.fn();
		const error = new Error("task failed");
		const mw = withErrorReporting((env: TestEnv) => env.ERROR_QUEUE, reporter);
		const wrapped = mw(vi.fn().mockRejectedValue(error), "failing-task");

		const event = createMockEvent("0 * * * *");
		const env = { ERROR_QUEUE: "my-queue" } as TestEnv;

		await expect(wrapped(event, env, createMockCtx())).rejects.toThrow("task failed");

		expect(reporter).toHaveBeenCalledWith(error, "failing-task", event, env);
	});

	it("uses default reporter (console.error) if none provided", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("oops");
		const mw = withErrorReporting((env: TestEnv) => env.ERROR_QUEUE);
		const wrapped = mw(vi.fn().mockRejectedValue(error), "task");

		await expect(
			wrapped(createMockEvent("0 * * * *"), { ERROR_QUEUE: "q" } as TestEnv, createMockCtx()),
		).rejects.toThrow("oops");

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
