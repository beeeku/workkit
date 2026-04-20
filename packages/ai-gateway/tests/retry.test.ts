import { ServiceUnavailableError, TimeoutError, ValidationError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
import { fallback } from "../src/fallback-wrapper";
import { withRetry } from "../src/retry";
import type { AiInput, AiOutput, Gateway, RunOptions } from "../src/types";

function makeGateway(run: Gateway["run"]): Gateway {
	return {
		run,
		providers: () => ["test"],
		defaultProvider: () => "test",
	};
}

function okOutput(model = "m"): AiOutput {
	return { text: "ok", raw: { text: "ok" }, provider: "test", model };
}

describe("withRetry()", () => {
	it("returns first-attempt success without retrying", async () => {
		const run = vi.fn().mockResolvedValue(okOutput());
		const gw = withRetry(makeGateway(run));

		await gw.run("m", { prompt: "x" });

		expect(run).toHaveBeenCalledTimes(1);
	});

	it("retries on retryable error and returns success", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new ServiceUnavailableError("upstream"))
			.mockResolvedValueOnce(okOutput());
		const gw = withRetry(makeGateway(run), { maxAttempts: 3 });

		const result = await gw.run("m", { prompt: "x" });

		expect(result.text).toBe("ok");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("throws after maxAttempts exhausted", async () => {
		const err = new ServiceUnavailableError("upstream");
		const run = vi.fn().mockRejectedValue(err);
		const gw = withRetry(makeGateway(run), { maxAttempts: 2 });

		await expect(gw.run("m", { prompt: "x" })).rejects.toThrow(ServiceUnavailableError);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("does not retry non-retryable errors", async () => {
		const run = vi.fn().mockRejectedValue(new ValidationError("bad", []));
		const gw = withRetry(makeGateway(run), { maxAttempts: 5 });

		await expect(gw.run("m", { prompt: "x" })).rejects.toThrow(ValidationError);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("respects custom isRetryable", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("plain error"))
			.mockResolvedValueOnce(okOutput());
		const gw = withRetry(makeGateway(run), {
			maxAttempts: 2,
			isRetryable: () => true,
		});

		const result = await gw.run("m", { prompt: "x" });

		expect(result.text).toBe("ok");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("aborts retry loop when signal is aborted between attempts", async () => {
		const controller = new AbortController();
		const run = vi.fn().mockImplementation(async () => {
			controller.abort();
			throw new ServiceUnavailableError("upstream");
		});
		const gw = withRetry(makeGateway(run), { maxAttempts: 5 });

		await expect(
			gw.run("m", { prompt: "x" } as AiInput, { signal: controller.signal } as RunOptions),
		).rejects.toThrow();

		expect(run).toHaveBeenCalledTimes(1);
	});

	it("passes model, input, and options through unchanged", async () => {
		const run = vi.fn().mockResolvedValue(okOutput("claude-sonnet-4-6"));
		const gw = withRetry(makeGateway(run));

		const input: AiInput = { messages: [{ role: "user", content: "hi" }] };
		const options: RunOptions = { provider: "anthropic", timeout: 500 };
		await gw.run("claude-sonnet-4-6", input, options);

		expect(run).toHaveBeenCalledWith("claude-sonnet-4-6", input, options);
	});

	it("exposes providers() and defaultProvider() from the wrapped gateway", () => {
		const inner = makeGateway(vi.fn());
		const gw = withRetry(inner);

		expect(gw.providers()).toEqual(["test"]);
		expect(gw.defaultProvider()).toBe("test");
	});

	it("throws RangeError when maxAttempts is 0, negative, or non-integer", () => {
		const gw = makeGateway(vi.fn());
		expect(() => withRetry(gw, { maxAttempts: 0 })).toThrow(RangeError);
		expect(() => withRetry(gw, { maxAttempts: -1 })).toThrow(RangeError);
		expect(() => withRetry(gw, { maxAttempts: 1.5 })).toThrow(RangeError);
	});

	it("retries TimeoutError (also retryable)", async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new TimeoutError("upstream", 100))
			.mockResolvedValueOnce(okOutput());
		const gw = withRetry(makeGateway(run), { maxAttempts: 3 });

		await gw.run("m", { prompt: "x" });
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe("withRetry() + fallback() — per-tier retry budget", () => {
	// Status field on a `ServiceUnavailableError` lets the same error trip both
	// `isRetryable` (it's retryable) and `matchesFallback({ on: [503] })` —
	// which is the case where the per-tier vs whole-call distinction matters.
	function svcUnavail(): ServiceUnavailableError {
		return new ServiceUnavailableError("upstream", { context: { status: 503 } });
	}

	it("primary's full retry budget exhausts before secondary is tried", async () => {
		// Primary always fails retryably; secondary succeeds on first attempt.
		// With per-tier retry, primary should be hit `maxAttempts` times THEN
		// secondary once — never re-entering primary after the first exhaustion.
		const run = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw svcUnavail();
			return okOutput("secondary-model");
		});
		const gw = withRetry(makeGateway(run), { maxAttempts: 3 });

		const ref = fallback("primary-model", "secondary-model", { on: [503] });
		const result = await gw.run(ref, { prompt: "x" });

		expect(result.via).toBe("secondary");
		const calls = run.mock.calls.map((c) => c[0]);
		expect(calls).toEqual(["primary-model", "primary-model", "primary-model", "secondary-model"]);
	});

	it("non-retryable but fallback-matched primary error → secondary runs immediately", async () => {
		// 401 → not retryable per @workkit/errors' classification, but it IS in
		// `on:[401]`. Per-tier retry must not artificially extend the primary's
		// attempts when the error is non-retryable to begin with.
		class Unauth extends Error {
			readonly status = 401;
		}
		const run = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw new Unauth("auth failed");
			return okOutput("secondary-model");
		});
		const gw = withRetry(makeGateway(run), { maxAttempts: 5 });

		const ref = fallback("primary-model", "secondary-model", { on: [401] });
		const result = await gw.run(ref, { prompt: "x" });

		expect(result.via).toBe("secondary");
		const calls = run.mock.calls.map((c) => c[0]);
		expect(calls).toEqual(["primary-model", "secondary-model"]);
	});

	it("primary recovers within its retry budget — secondary is never invoked", async () => {
		const run = vi
			.fn<Gateway["run"]>()
			.mockRejectedValueOnce(svcUnavail())
			.mockResolvedValueOnce(okOutput("primary-model"));
		const gw = withRetry(makeGateway(run), { maxAttempts: 3 });

		const ref = fallback("primary-model", "secondary-model", { on: [503] });
		const result = await gw.run(ref, { prompt: "x" });

		expect(result.via).toBe("primary");
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls.every((c) => c[0] === "primary-model")).toBe(true);
	});

	it("secondary also gets its own retry budget", async () => {
		// Primary exhausts (2 attempts), secondary fails-then-succeeds (2 attempts).
		// Confirms per-tier retry applies to the secondary tier too, not just the primary.
		let primaryAttempts = 0;
		let secondaryAttempts = 0;
		const run = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") {
				primaryAttempts++;
				throw svcUnavail();
			}
			secondaryAttempts++;
			if (secondaryAttempts === 1) throw svcUnavail();
			return okOutput("secondary-model");
		});
		const gw = withRetry(makeGateway(run), { maxAttempts: 2 });

		const ref = fallback("primary-model", "secondary-model", { on: [503] });
		const result = await gw.run(ref, { prompt: "x" });

		expect(result.via).toBe("secondary");
		expect(primaryAttempts).toBe(2);
		expect(secondaryAttempts).toBe(2);
	});
});
