import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileError } from "../src/errors";
import { verifyTurnstile } from "../src/verify";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function mockFetchResponse(body: Record<string, unknown>, status = 200) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

describe("verifyTurnstile", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("returns success for a valid token", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
			action: "login",
			cdata: "session-id",
		});

		const result = await verifyTurnstile("valid-token", "secret-key");

		expect(result.success).toBe(true);
		expect(result.challengeTs).toBe("2025-01-01T00:00:00.000Z");
		expect(result.hostname).toBe("example.com");
		expect(result.errorCodes).toEqual([]);
		expect(result.action).toBe("login");
		expect(result.cdata).toBe("session-id");

		expect(globalThis.fetch).toHaveBeenCalledWith(
			SITEVERIFY_URL,
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ secret: "secret-key", response: "valid-token" }),
			}),
		);
	});

	it("returns failure for an invalid token", async () => {
		globalThis.fetch = mockFetchResponse({
			success: false,
			challenge_ts: "",
			hostname: "",
			"error-codes": ["invalid-input-response"],
		});

		const result = await verifyTurnstile("invalid-token", "secret-key");

		expect(result.success).toBe(false);
		expect(result.errorCodes).toEqual(["invalid-input-response"]);
	});

	it("returns failure for an expired token", async () => {
		globalThis.fetch = mockFetchResponse({
			success: false,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": ["timeout-or-duplicate"],
		});

		const result = await verifyTurnstile("expired-token", "secret-key");

		expect(result.success).toBe(false);
		expect(result.errorCodes).toEqual(["timeout-or-duplicate"]);
	});

	it("sends remoteIp when provided", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		await verifyTurnstile("token", "secret", { remoteIp: "1.2.3.4" });

		expect(globalThis.fetch).toHaveBeenCalledWith(
			SITEVERIFY_URL,
			expect.objectContaining({
				body: JSON.stringify({
					secret: "secret",
					response: "token",
					remoteip: "1.2.3.4",
				}),
			}),
		);
	});

	it("sends idempotency key when provided", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		await verifyTurnstile("token", "secret", { idempotencyKey: "idem-123" });

		expect(globalThis.fetch).toHaveBeenCalledWith(
			SITEVERIFY_URL,
			expect.objectContaining({
				body: JSON.stringify({
					secret: "secret",
					response: "token",
					idempotency_key: "idem-123",
				}),
			}),
		);
	});

	it("fails when action does not match expectedAction", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
			action: "signup",
		});

		const result = await verifyTurnstile("token", "secret", { expectedAction: "login" });

		expect(result.success).toBe(false);
		expect(result.errorCodes).toContain("action-mismatch");
	});

	it("succeeds when action matches expectedAction", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
			action: "login",
		});

		const result = await verifyTurnstile("token", "secret", { expectedAction: "login" });

		expect(result.success).toBe(true);
		expect(result.action).toBe("login");
	});

	it("throws TurnstileError on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

		await expect(verifyTurnstile("token", "secret")).rejects.toThrow(TurnstileError);
		await expect(verifyTurnstile("token", "secret")).rejects.toThrow(
			"Turnstile verification request failed",
		);
	});

	it("throws TurnstileError on timeout", async () => {
		vi.useRealTimers();

		globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
			return new Promise((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => {
					reject(new DOMException("The operation was aborted.", "AbortError"));
				});
			});
		});

		await expect(verifyTurnstile("token", "secret", { timeout: 10 })).rejects.toThrow(
			TurnstileError,
		);
		await expect(verifyTurnstile("token", "secret", { timeout: 10 })).rejects.toThrow("timed out");
	});
});
