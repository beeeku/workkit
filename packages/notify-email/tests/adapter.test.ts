import type { AdapterSendArgs, ChannelTemplate } from "@workkit/notify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailPayload, emailAdapter } from "../src/adapter";
import { FromDomainError } from "../src/errors";

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

function callArgs(template: ChannelTemplate<EmailPayload>): AdapterSendArgs<EmailPayload> {
	return {
		userId: "u1",
		notificationId: "pre-market-brief",
		channel: "email",
		address: "user@example.com",
		template,
		payload: { subject: "NIFTY", body: "<p>hi</p>" },
		deliveryId: "d1",
		mode: "live",
	};
}

describe("emailAdapter()", () => {
	it("rejects an invalid `from` at construction", () => {
		expect(() => emailAdapter({ apiKey: "x", from: "not-an-email" })).toThrow(FromDomainError);
	});

	it("posts to Resend with the rendered HTML + text and returns providerId on 200", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "resend_id_1" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const adapter = emailAdapter({ apiKey: "k", from: "Reports <reports@x.example.com>" });
		const result = await adapter.send(
			callArgs({ title: () => "NIFTY", body: () => "<p>hi</p>" } as ChannelTemplate<EmailPayload>),
		);
		expect(result.status).toBe("sent");
		expect(result.providerId).toBe("resend_id_1");
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const [, opts] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse((opts as RequestInit).body as string);
		expect(body.to).toEqual(["user@example.com"]);
		expect(body.subject).toBe("NIFTY");
		expect(body.html).toBe("<p>hi</p>");
		expect(body.text).toBe("hi");
	});

	it("returns failed when Resend returns 4xx", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "from-domain not verified" } }), {
				status: 403,
				headers: { "content-type": "application/json" },
			}),
		);
		const adapter = emailAdapter({ apiKey: "k", from: "x@example.com" });
		const result = await adapter.send(callArgs({ body: () => "<p>x</p>" }));
		expect(result.status).toBe("failed");
		expect(result.error).toContain("from-domain");
	});

	it("returns failed when Resend response is missing id", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({}), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const adapter = emailAdapter({ apiKey: "k", from: "x@example.com" });
		const result = await adapter.send(callArgs({ body: () => "<p>x</p>" }));
		expect(result.status).toBe("failed");
	});

	it("returns failed when fetch throws (network error)", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("ENOTFOUND"),
		);
		const adapter = emailAdapter({ apiKey: "k", from: "x@example.com" });
		const result = await adapter.send(callArgs({ body: () => "<p>x</p>" }));
		expect(result.status).toBe("failed");
		expect(result.error).toContain("ENOTFOUND");
	});

	it("invokes the auto-opt-out hook on a complaint webhook event", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const adapter = emailAdapter({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify([
				{
					type: "email.complained",
					created_at: "2026-04-18T05:00:00Z",
					data: { email_id: "id1", to: ["user@example.com"] },
				},
			]),
		});
		await adapter.parseWebhook!(req);
		expect(hook).toHaveBeenCalledWith("user@example.com", "email", null, "complaint");
	});

	it("invokes the auto-opt-out hook on a hard bounce", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const adapter = emailAdapter({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify({
				type: "email.bounced",
				created_at: "2026-04-18T05:00:00Z",
				data: { email_id: "id1", to: ["user@example.com"], bounce: { type: "hard" } },
			}),
		});
		await adapter.parseWebhook!(req);
		expect(hook).toHaveBeenCalledWith("user@example.com", "email", null, "hard-bounce");
	});

	it("does NOT invoke the hook on a transient bounce", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const adapter = emailAdapter({
			apiKey: "k",
			from: "x@example.com",
			autoOptOut: { hook },
		});
		const req = new Request("https://example.com/webhook", {
			method: "POST",
			body: JSON.stringify({
				type: "email.bounced",
				created_at: "2026-04-18T05:00:00Z",
				data: { email_id: "id1", to: ["user@example.com"], bounce: { type: "transient" } },
			}),
		});
		await adapter.parseWebhook!(req);
		expect(hook).not.toHaveBeenCalled();
	});
});
