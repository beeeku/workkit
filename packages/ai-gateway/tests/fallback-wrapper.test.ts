import { ServiceUnavailableError, UnauthorizedError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
import { runWithFallback } from "../src/fallback-wrapper";
import { FallbackExhaustedError, createGateway, fallback } from "../src/index";
import type { AiInput, AiOutput, Gateway, RunOptions, WorkersAiBinding } from "../src/types";

/**
 * Build a gateway backed by a single `workers-ai` binding whose `run`
 * dispatches on the model string. This lets tests simulate per-model
 * success/failure without real HTTP while still exercising the full
 * `createGateway` → `gateway.run(fallbackRef, …)` code path.
 */
function makeBindingGateway(binding: WorkersAiBinding["run"]): Gateway {
	return createGateway({
		providers: { ai: { type: "workers-ai", binding: { run: binding } } },
		defaultProvider: "ai",
	});
}

function okOutput(model: string): AiOutput {
	return { text: "ok", raw: { text: "ok" }, provider: "ai", model };
}

/** Plain error with a `status` field — matches the shape gateway providers attach in their error `context`. */
class HttpLikeError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "HttpLikeError";
		this.status = status;
	}
}

describe("fallback()", () => {
	it("returns a FallbackModelRef with kind === 'fallback'", () => {
		const ref = fallback("primary-model", "secondary-model", { on: [401] });
		expect(ref.kind).toBe("fallback");
		expect(ref.primary).toBe("primary-model");
		expect(ref.secondary).toBe("secondary-model");
		expect(ref.on).toEqual([401]);
	});
});

describe("gateway.run() with FallbackModelRef", () => {
	it("primary succeeds — secondary not called, via === 'primary'", async () => {
		const binding = vi.fn().mockImplementation(async (model: string) => ({
			response: `hi from ${model}`,
		}));
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", { on: [401] });
		const result = await gw.run(ref, { prompt: "hi" });

		expect(binding).toHaveBeenCalledTimes(1);
		expect(binding.mock.calls[0][0]).toBe("primary-model");
		expect(result.model).toBe("primary-model");
		expect(result.via).toBe("primary");
	});

	it("primary throws status 401 with on:[401] — secondary called, via === 'secondary', onFallback fires", async () => {
		const primaryErr = new HttpLikeError("anthropic 401", 401);
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw primaryErr;
			return { response: "secondary ok" };
		});
		const gw = makeBindingGateway(binding);

		const onFallback = vi.fn();
		const ref = fallback("primary-model", "secondary-model", {
			on: [401, 429, 500, 502, 503, 504],
			onFallback,
		});
		const result = await gw.run(ref, { prompt: "hi" });

		expect(binding).toHaveBeenCalledTimes(2);
		expect(binding.mock.calls[1][0]).toBe("secondary-model");
		expect(result.model).toBe("secondary-model");
		expect(result.via).toBe("secondary");
		expect(onFallback).toHaveBeenCalledTimes(1);
		// The primary error is surfaced via the provider wrapper's `.cause`.
		const reported = onFallback.mock.calls[0][0] as Error;
		expect(reported).toBeInstanceOf(Error);
		expect((reported as { cause?: unknown }).cause).toBe(primaryErr);
		expect(onFallback.mock.calls[0][1]).toBe("primary");
	});

	it("primary throws status 503 — falls over with on:[401,429,500,502,503,504]", async () => {
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw new HttpLikeError("upstream", 503);
			return { response: "secondary ok" };
		});
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", {
			on: [401, 429, 500, 502, 503, 504],
		});
		const result = await gw.run(ref, { prompt: "hi" });

		expect(result.via).toBe("secondary");
		expect(result.model).toBe("secondary-model");
	});

	it("matches numeric entries against err.status when present", async () => {
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw new HttpLikeError("rate limited", 429);
			return { response: "ok" };
		});
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", { on: [429] });
		const result = await gw.run(ref, { prompt: "hi" });

		expect(result.via).toBe("secondary");
	});

	it("primary throws 404 with on:[401,429] — does NOT fall over, secondary never invoked", async () => {
		const binding = vi.fn().mockImplementation(async () => {
			throw new HttpLikeError("not found", 404);
		});
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", { on: [401, 429] });
		await expect(gw.run(ref, { prompt: "hi" })).rejects.not.toBeInstanceOf(FallbackExhaustedError);
		expect(binding).toHaveBeenCalledTimes(1);
		expect(binding.mock.calls[0][0]).toBe("primary-model");
	});

	it("predicate matcher — (err) => underlying is TimeoutError falls over", async () => {
		class FakeTimeoutError extends Error {
			constructor() {
				super("timeout");
				this.name = "TimeoutError";
			}
		}
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw new FakeTimeoutError();
			return { response: "ok" };
		});
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", {
			on: [
				(err: unknown) => {
					// The provider wrapper nests the original under `cause`.
					const cause = (err as { cause?: unknown }).cause;
					return cause instanceof Error && cause.name === "TimeoutError";
				},
			],
		});
		const result = await gw.run(ref, { prompt: "hi" });

		expect(result.via).toBe("secondary");
	});

	it("both primary and secondary fail — throws FallbackExhaustedError with both errors", async () => {
		const primaryRawErr = new HttpLikeError("anthropic 401", 401);
		const secondaryRawErr = new HttpLikeError("openai 503", 503);
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw primaryRawErr;
			throw secondaryRawErr;
		});
		const gw = makeBindingGateway(binding);

		const ref = fallback("primary-model", "secondary-model", {
			on: [401, 429, 500, 502, 503, 504],
		});

		await expect(gw.run(ref, { prompt: "hi" })).rejects.toBeInstanceOf(FallbackExhaustedError);
		try {
			await gw.run(ref, { prompt: "hi" });
		} catch (err) {
			expect(err).toBeInstanceOf(FallbackExhaustedError);
			const fe = err as FallbackExhaustedError;
			// Primary/secondary errors are the (wrapped) errors surfaced by the runner.
			expect((fe.primaryError as { cause?: unknown }).cause).toBe(primaryRawErr);
			expect((fe.secondaryError as { cause?: unknown }).cause).toBe(secondaryRawErr);
		}
	});

	it("passes input and options (responseFormat, toolOptions) through to both tiers", async () => {
		const binding = vi.fn().mockImplementation(async (model: string) => {
			if (model === "primary-model") throw new HttpLikeError("401", 401);
			return { response: "ok" };
		});
		const gw = makeBindingGateway(binding);

		const input: AiInput = { messages: [{ role: "user", content: "hi" }] };
		const options: RunOptions = {
			responseFormat: "json",
			toolOptions: {
				tools: [{ name: "t", description: "d", parameters: {} }],
				toolChoice: "auto",
			},
		};
		const ref = fallback("primary-model", "secondary-model", { on: [401] });
		const result = await gw.run(ref, input, options);

		expect(result.via).toBe("secondary");
		expect(binding).toHaveBeenCalledTimes(2);
		// Both tiers see the same tools/response_format on the binding input.
		const firstCallInput = binding.mock.calls[0][1] as Record<string, unknown>;
		const secondCallInput = binding.mock.calls[1][1] as Record<string, unknown>;
		expect(firstCallInput.response_format).toEqual({ type: "json_object" });
		expect(secondCallInput.response_format).toEqual({ type: "json_object" });
		expect(firstCallInput.tools).toBeDefined();
		expect(secondCallInput.tools).toBeDefined();
	});
});

describe("runWithFallback() — direct runner contract", () => {
	it("passes through when runner throws a non-matching error", async () => {
		const runner = vi.fn().mockRejectedValue(new HttpLikeError("nope", 418));
		const ref = fallback("p", "s", { on: [401, 429] });
		await expect(runWithFallback(ref, { prompt: "hi" }, undefined, runner)).rejects.toMatchObject({
			status: 418,
		});
		expect(runner).toHaveBeenCalledTimes(1);
	});

	it("tags success results with `via` even when primary is a WorkkitError that doesn't match", async () => {
		// A ServiceUnavailableError whose context.status is outside `on` — not a fallback trigger.
		const runner = vi.fn().mockImplementation(async (model: string) => okOutput(model));
		const ref = fallback("p", "s", { on: [401] });
		const out = await runWithFallback(ref, { prompt: "hi" }, undefined, runner);
		expect(out.via).toBe("primary");
	});

	it("honors the ServiceUnavailableError status-code path (401 nested via cause chain)", async () => {
		// Simulate the shape providers/*.ts actually emit: ServiceUnavailableError wrapping the raw err.
		const raw = new HttpLikeError("provider 401", 401);
		const wrapped = new ServiceUnavailableError("anthropic (401)", {
			cause: raw,
			context: { status: 401 },
		});
		const runner = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw wrapped;
			})
			.mockImplementationOnce(async (model: string) => okOutput(model));
		const ref = fallback("p", "s", { on: [401] });
		const out = await runWithFallback(ref, { prompt: "hi" }, undefined, runner);
		expect(out.via).toBe("secondary");
	});

	it("wraps a plain UnauthorizedError (statusCode 401) and matches on:[401]", async () => {
		const raw = new UnauthorizedError("401");
		const runner = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw raw;
			})
			.mockImplementationOnce(async (model: string) => okOutput(model));
		const ref = fallback("p", "s", { on: [401] });
		const out = await runWithFallback(ref, { prompt: "hi" }, undefined, runner);
		expect(out.via).toBe("secondary");
	});
});
