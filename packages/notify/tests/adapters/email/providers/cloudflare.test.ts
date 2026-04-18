import { createMockSendEmail } from "@workkit/testing";
import { describe, expect, it } from "vitest";
import { cloudflareEmailProvider } from "../../../../src/adapters/email/providers/cloudflare";

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

describe("cloudflareEmailProvider", () => {
	it("has name 'cloudflare'", () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		expect(provider.name).toBe("cloudflare");
	});

	it("omits parseWebhook and verifySignature (no CF webhooks)", () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		expect(provider.parseWebhook).toBeUndefined();
		expect(provider.verifySignature).toBeUndefined();
	});

	it("sends via the binding and returns providerId", async () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("sent");
		expect(result.providerId).toBeDefined();
		expect(binding._sent).toHaveLength(1);
		expect(binding._sent[0].from).toBe("x@example.com");
		expect(binding._sent[0].to).toBe("user@example.com");
		expect(binding._sent[0].raw).toContain("Subject:");
		expect(binding._sent[0].raw).toContain("<p>hi</p>");
	});

	it("catches mail DeliveryError and returns failed", async () => {
		const failingBinding = {
			async send() {
				throw new Error("Network failure");
			},
		};
		const provider = cloudflareEmailProvider({
			binding: failingBinding as unknown as SendEmail,
			from: "x@example.com",
		});
		const result = await provider.send(baseArgs());
		expect(result.status).toBe("failed");
		expect(result.error).toBeDefined();
	});

	it("catches mail InvalidAddressError and returns failed", async () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		const result = await provider.send({ ...baseArgs(), to: "not-an-email" });
		expect(result.status).toBe("failed");
		expect(result.error).toBeDefined();
	});

	it("forwards replyTo into the composed MIME", async () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
			replyTo: "reply@example.com",
		});
		await provider.send(baseArgs());
		expect(binding._sent[0].raw).toContain("Reply-To:");
		expect(binding._sent[0].raw).toContain("reply@example.com");
	});

	it("forwards attachments to @workkit/mail", async () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		const result = await provider.send({
			...baseArgs(),
			attachments: [
				{
					filename: "a.txt",
					content: new TextEncoder().encode("hello"),
					contentType: "text/plain",
				},
			],
		});
		expect(result.status).toBe("sent");
		expect(binding._sent[0].raw).toContain("a.txt");
	});

	it("forwards custom headers into the composed MIME", async () => {
		const binding = createMockSendEmail();
		const provider = cloudflareEmailProvider({
			binding: binding as unknown as SendEmail,
			from: "x@example.com",
		});
		await provider.send({
			...baseArgs(),
			headers: { "X-Entity-Ref-ID": "d1" },
		});
		expect(binding._sent[0].raw).toContain("X-Entity-Ref-ID: d1");
	});
});
