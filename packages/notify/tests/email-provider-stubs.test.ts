import { describe, expect, it } from "vitest";
import { postmarkEmailProvider } from "../src/adapters/email/providers/postmark";
import { sesEmailProvider } from "../src/adapters/email/providers/ses";

describe("sesEmailProvider stub", () => {
	const provider = sesEmailProvider({
		region: "us-east-1",
		accessKeyId: "AKIA0",
		secretAccessKey: "secret",
		from: "noreply@example.com",
	});

	it("constructs without throwing", () => {
		expect(provider.name).toBe("ses");
	});

	it("send() throws NotImplementedError citing #57", async () => {
		await expect(
			provider.send({
				to: "user@example.com",
				subject: "x",
				html: "<p>x</p>",
				text: "x",
				notificationId: "n",
				deliveryId: "d",
			}),
		).rejects.toThrow(/issues\/57/);
	});

	it("parseWebhook() and verifySignature() throw NotImplementedError", async () => {
		const req = new Request("https://example.com/webhook");
		await expect(provider.parseWebhook?.(req)).rejects.toThrow(/issues\/57/);
		await expect(provider.verifySignature?.(req, "secret")).rejects.toThrow(/issues\/57/);
	});
});

describe("postmarkEmailProvider stub", () => {
	const provider = postmarkEmailProvider({
		serverToken: "00000000-0000-0000-0000-000000000000",
		from: "noreply@example.com",
	});

	it("constructs without throwing", () => {
		expect(provider.name).toBe("postmark");
	});

	it("send() throws NotImplementedError citing #57", async () => {
		await expect(
			provider.send({
				to: "user@example.com",
				subject: "x",
				html: "<p>x</p>",
				text: "x",
				notificationId: "n",
				deliveryId: "d",
			}),
		).rejects.toThrow(/issues\/57/);
	});

	it("parseWebhook() and verifySignature() throw NotImplementedError", async () => {
		const req = new Request("https://example.com/webhook");
		await expect(provider.parseWebhook?.(req)).rejects.toThrow(/issues\/57/);
		await expect(provider.verifySignature?.(req, "secret")).rejects.toThrow(/issues\/57/);
	});
});
