import { ServiceUnavailableError, ValidationError, WorkkitError } from "@workkit/errors";
import type { RetryStrategy } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { adapterFailedFromError } from "../src/adapter-result";

describe("adapterFailedFromError()", () => {
	it("WorkkitError → preserves retryable + retryStrategy", () => {
		const err = new ServiceUnavailableError("upstream");

		const result = adapterFailedFromError(err);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("upstream");
		expect(result.retryable).toBe(true);
		expect(result.retryStrategy).toEqual(expect.objectContaining({ kind: "exponential" }));
	});

	it("non-retryable WorkkitError → retryable: false", () => {
		const err = new ValidationError("bad input", []);

		const result = adapterFailedFromError(err);

		expect(result.status).toBe("failed");
		expect(result.retryable).toBe(false);
		expect(result.retryStrategy).toEqual({ kind: "none" });
	});

	it("plain Error → status:'failed' + error message; structured fields undefined", () => {
		const result = adapterFailedFromError(new Error("plain old failure"));

		expect(result.status).toBe("failed");
		expect(result.error).toBe("plain old failure");
		expect(result.retryable).toBeUndefined();
		expect(result.retryStrategy).toBeUndefined();
	});

	it("non-Error thrown value → stringified", () => {
		const result = adapterFailedFromError("string thrown directly");

		expect(result.status).toBe("failed");
		expect(result.error).toBe("string thrown directly");
		expect(result.retryable).toBeUndefined();
	});

	it("custom WorkkitError with overridden retryStrategy → preserved", () => {
		// Subclass to control the retry strategy precisely.
		class CustomFlaky extends WorkkitError {
			readonly code = "WORKKIT_INTERNAL" as const;
			readonly statusCode = 502;
			readonly retryable = true;
			readonly defaultRetryStrategy: RetryStrategy = {
				kind: "fixed",
				delayMs: 250,
				maxAttempts: 4,
			};
		}

		const result = adapterFailedFromError(new CustomFlaky("test"));

		expect(result.retryable).toBe(true);
		expect(result.retryStrategy).toEqual({ kind: "fixed", delayMs: 250, maxAttempts: 4 });
	});
});
