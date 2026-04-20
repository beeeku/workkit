import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FromDomainError } from "../../../../src/adapters/email/errors";
import { resendEmailProvider } from "../../../../src/adapters/email/providers/resend";

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

function baseArgs() {
	return {
		to: "user@example.com",
		subject: "Hi",
		html: "<p>hi</p>",
		text: "hi",
		notificationId: "n1",
		deliveryId: "d1",
	};
}

describe("resendEmailProvider", () => {
	it("has name 'resend'", () => {
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		expect(provider.name).toBe("resend");
	});

	it("rejects an invalid `from` at construction", () => {
		expect(() => resendEmailProvider({ apiKey: "k", from: "not-an-email" })).toThrow(
			FromDomainError,
		);
	});

	it("posts to Resend and returns providerId on 200", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "resend_id" }), { status: 200 }),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("sent");
		expect(result.providerId).toBe("resend_id");
	});

	it("forwards replyTo from provider options", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "i" }), { status: 200 }),
		);
		const provider = resendEmailProvider({
			apiKey: "k",
			from: "x@example.com",
			replyTo: "reply@example.com",
		});
		await provider.send(baseArgs());
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const [, opts] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse((opts as RequestInit).body as string);
		expect(body.reply_to).toBe("reply@example.com");
	});

	it("returns failed on 4xx (terminal — not retryable)", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "from-domain not verified" } }), {
				status: 403,
			}),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.error).toContain("from-domain");
		// 4xx (other than 429) is a terminal failure — no retry value.
		expect(result.retryable).toBe(false);
		expect(result.retryStrategy).toEqual({ kind: "none" });
	});

	it("returns failed on 429 with retryable: true (rate-limited)", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.retryable).toBe(true);
		expect(result.retryStrategy?.kind).toBe("exponential");
	});

	it("returns failed on 5xx with retryable: true (transient)", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response("upstream error", { status: 503 }),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.retryable).toBe(true);
		expect(result.retryStrategy?.kind).toBe("exponential");
	});

	it("returns failed when fetch throws (network error → retryable)", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("ENOTFOUND"),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.error).toContain("ENOTFOUND");
		// Network failures (DNS, TLS, connection reset) are always retryable.
		expect(result.retryable).toBe(true);
		expect(result.retryStrategy?.kind).toBe("exponential");
	});

	it("returns failed when response lacks id", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({}), { status: 200 }),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.error).toContain("missing id");
	});

	it("fires auto-opt-out hook on complaint", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const provider = resendEmailProvider({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify({
				type: "email.complained",
				data: { email_id: "id1", to: ["user@example.com"] },
			}),
		});
		await provider.parseWebhook!(req);
		expect(hook).toHaveBeenCalledWith("user@example.com", "email", null, "complaint");
	});

	it("fires auto-opt-out hook on hard bounce", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const provider = resendEmailProvider({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify({
				type: "email.bounced",
				data: { email_id: "id1", to: ["user@example.com"], bounce: { type: "hard" } },
			}),
		});
		await provider.parseWebhook!(req);
		expect(hook).toHaveBeenCalledWith("user@example.com", "email", null, "hard-bounce");
	});

	it("does NOT fire hook on transient bounce", async () => {
		const hook = vi.fn();
		const provider = resendEmailProvider({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify({
				type: "email.bounced",
				data: { email_id: "id1", to: ["user@example.com"], bounce: { type: "transient" } },
			}),
		});
		await provider.parseWebhook!(req);
		expect(hook).not.toHaveBeenCalled();
	});

	it("parseWebhook returns empty on malformed JSON without throwing", async () => {
		const hook = vi.fn();
		const provider = resendEmailProvider({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: "{not-json",
		});
		await expect(provider.parseWebhook!(req)).resolves.toEqual([]);
		expect(hook).not.toHaveBeenCalled();
	});

	it("encodes attachments as base64", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "i" }), { status: 200 }),
		);
		const provider = resendEmailProvider({ apiKey: "k", from: "x@example.com" });
		await provider.send({
			...baseArgs(),
			attachments: [
				{
					filename: "a.txt",
					content: new TextEncoder().encode("hello"),
					contentType: "text/plain",
				},
			],
		});
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const [, opts] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse((opts as RequestInit).body as string);
		expect(body.attachments[0].filename).toBe("a.txt");
		expect(body.attachments[0].content).toBe(btoa("hello"));
		expect(body.attachments[0].content_type).toBe("text/plain");
	});
});
