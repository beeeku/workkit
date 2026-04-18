import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailPayload, emailAdapter } from "../../../src/adapters/email/adapter";
import { FromDomainError, ProviderMissingError } from "../../../src/adapters/email/errors";
import { resendEmailProvider } from "../../../src/adapters/email/providers/resend";
import type { AdapterSendArgs, ChannelTemplate } from "../../../src/types";

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
	it("throws ProviderMissingError when provider is absent", () => {
		expect(() => emailAdapter({} as never)).toThrow(ProviderMissingError);
	});

	it("propagates FromDomainError from the Resend provider constructor", () => {
		expect(() => resendEmailProvider({ apiKey: "x", from: "not-an-email" })).toThrow(
			FromDomainError,
		);
	});

	it("delegates send to the provider and returns its result", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "resend_id_1" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const adapter = emailAdapter({
			provider: resendEmailProvider({ apiKey: "k", from: "Reports <reports@x.example.com>" }),
		});
		const result = await adapter.send(
			callArgs({ title: () => "NIFTY", body: () => "<p>hi</p>" } as ChannelTemplate<EmailPayload>),
		);
		expect(result.status).toBe("sent");
		expect(result.providerId).toBe("resend_id_1");
	});

	it("attaches List-Unsubscribe headers for notification ids in markUnsubscribable", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: "i" }), { status: 200 }),
		);
		const adapter = emailAdapter({
			provider: resendEmailProvider({ apiKey: "k", from: "x@example.com" }),
			markUnsubscribable: ["pre-market-brief"],
		});
		await adapter.send(callArgs({ body: () => "<p>x</p>" }));
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const [, opts] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse((opts as RequestInit).body as string);
		expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
		expect(body.headers["X-Entity-Ref-ID"]).toBe("d1");
	});

	it("omits parseWebhook when provider does not implement it", () => {
		const adapter = emailAdapter({
			provider: {
				name: "cloudflare",
				async send() {
					return { status: "sent", providerId: "id" };
				},
			},
		});
		expect(adapter.parseWebhook).toBeUndefined();
		expect(adapter.verifySignature).toBeUndefined();
	});

	it("exposes parseWebhook / verifySignature when the provider implements them", () => {
		const adapter = emailAdapter({
			provider: resendEmailProvider({ apiKey: "k", from: "x@example.com" }),
		});
		expect(typeof adapter.parseWebhook).toBe("function");
		expect(typeof adapter.verifySignature).toBe("function");
	});

	it("delegates parseWebhook to the provider (auto-opt-out hook fires)", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		const adapter = emailAdapter({
			provider: resendEmailProvider({
				apiKey: "k",
				from: "x@example.com",
				autoOptOut: { hook },
			}),
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
});
