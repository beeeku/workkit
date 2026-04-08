// tests/timeout.test.ts
import { describe, expect, it } from "vitest";
import { executeWithTimeout } from "../src/timeout";

describe("executeWithTimeout", () => {
	it("returns handler result when within timeout", async () => {
		const result = await executeWithTimeout(async () => "ok", 1000, new AbortController().signal);
		expect(result).toBe("ok");
	});

	it("throws TimeoutError when handler exceeds timeout", async () => {
		await expect(
			executeWithTimeout(
				() => new Promise((resolve) => setTimeout(resolve, 500)),
				50,
				new AbortController().signal,
			),
		).rejects.toThrow("exceeded");
	});

	it("aborts when signal fires", async () => {
		const controller = new AbortController();

		const promise = executeWithTimeout(
			() => new Promise((resolve) => setTimeout(resolve, 5000)),
			10000,
			controller.signal,
		);

		controller.abort(new Error("cancelled"));

		await expect(promise).rejects.toThrow("cancelled");
	});

	it("clears timeout on successful completion", async () => {
		const result = await executeWithTimeout(async () => 42, 5000, new AbortController().signal);
		expect(result).toBe(42);
	});
});
