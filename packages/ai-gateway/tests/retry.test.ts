import { ServiceUnavailableError, TimeoutError, ValidationError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
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
