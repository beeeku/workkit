import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstile } from "../src/middleware";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function mockFetchResponse(body: Record<string, unknown>) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

describe("turnstile middleware", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("extracts token from header and sets context on success", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret" }));
		app.post("/api/submit", (c) => {
			const result = c.get("turnstile" as never);
			return c.json({ result });
		});

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: {
				"cf-turnstile-response": "valid-token",
			},
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { result: { success: boolean; hostname: string } };
		expect(json.result.success).toBe(true);
		expect(json.result.hostname).toBe("example.com");
	});

	it("extracts token from JSON body field", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret" }));
		app.post("/api/submit", (c) => {
			const result = c.get("turnstile" as never);
			return c.json({ result });
		});

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ "cf-turnstile-response": "body-token", data: "value" }),
		});

		expect(res.status).toBe(200);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			SITEVERIFY_URL,
			expect.objectContaining({
				body: expect.stringContaining("body-token"),
			}),
		);
	});

	it("returns 403 when no token is present", async () => {
		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		const res = await app.request("/api/submit", {
			method: "POST",
		});

		expect(res.status).toBe(403);
		const json = (await res.json()) as { error: string; codes: string[] };
		expect(json.error).toBe("Turnstile verification failed");
		expect(json.codes).toContain("missing-input-response");
	});

	it("returns 403 when verification fails", async () => {
		globalThis.fetch = mockFetchResponse({
			success: false,
			challenge_ts: "",
			hostname: "",
			"error-codes": ["invalid-input-response"],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: { "cf-turnstile-response": "bad-token" },
		});

		expect(res.status).toBe(403);
		const json = (await res.json()) as { error: string; codes: string[] };
		expect(json.error).toBe("Turnstile verification failed");
		expect(json.codes).toContain("invalid-input-response");
	});

	it("uses custom header name", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret", headerName: "x-turnstile-token" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: { "x-turnstile-token": "custom-header-token" },
		});

		expect(res.status).toBe(200);
	});

	it("uses custom body field name", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret", fieldName: "turnstileToken" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ turnstileToken: "body-field-token" }),
		});

		expect(res.status).toBe(200);
	});

	it("forwards remote IP from configured header", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		await app.request("/api/submit", {
			method: "POST",
			headers: {
				"cf-turnstile-response": "token",
				"cf-connecting-ip": "203.0.113.1",
			},
		});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			SITEVERIFY_URL,
			expect.objectContaining({
				body: expect.stringContaining("203.0.113.1"),
			}),
		);
	});

	it("passes expectedAction to verification", async () => {
		globalThis.fetch = mockFetchResponse({
			success: true,
			challenge_ts: "2025-01-01T00:00:00.000Z",
			hostname: "example.com",
			"error-codes": [],
			action: "signup",
		});

		const app = new Hono();
		app.use("/api/*", turnstile({ secretKey: "test-secret", expectedAction: "login" }));
		app.post("/api/submit", (c) => c.json({ ok: true }));

		const res = await app.request("/api/submit", {
			method: "POST",
			headers: { "cf-turnstile-response": "token" },
		});

		expect(res.status).toBe(403);
		const json = (await res.json()) as { error: string; codes: string[] };
		expect(json.codes).toContain("action-mismatch");
	});
});
