import {
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { FontLoadError, normalizeBrowserError } from "../src/errors";

describe("normalizeBrowserError", () => {
	it("maps 429 + Retry-After seconds to RateLimitError with retryAfterMs", () => {
		const err = normalizeBrowserError("test", {
			status: 429,
			message: "rate limited",
			headers: new Headers({ "Retry-After": "2" }),
		});
		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfterMs).toBe(2000);
	});

	it("maps 429 with no Retry-After to RateLimitError", () => {
		const err = normalizeBrowserError("test", { status: 429, message: "rate limited" });
		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfterMs).toBeUndefined();
	});

	it("maps 503/502/504 to ServiceUnavailableError", () => {
		for (const status of [502, 503, 504]) {
			const err = normalizeBrowserError("test", { status, message: "down" });
			expect(err).toBeInstanceOf(ServiceUnavailableError);
		}
	});

	it("maps 'timeout' message to TimeoutError", () => {
		const err = normalizeBrowserError(
			"setContent",
			new Error("Navigation timed out after 30000ms"),
		);
		expect(err).toBeInstanceOf(TimeoutError);
	});

	it("falls back to ServiceUnavailableError for unknown failures", () => {
		const err = normalizeBrowserError("test", new Error("boom"));
		expect(err).toBeInstanceOf(ServiceUnavailableError);
	});

	it("passes through native AbortError", () => {
		const abort = new Error("aborted");
		abort.name = "AbortError";
		const err = normalizeBrowserError("test", abort);
		expect(err).toBe(abort);
	});

	it("FontLoadError extends ValidationError and carries family context", () => {
		const err = new FontLoadError("Inter");
		expect(err).toBeInstanceOf(ValidationError);
		expect(err.message).toContain("Inter");
		expect(err.context).toMatchObject({ family: "Inter" });
	});
});
