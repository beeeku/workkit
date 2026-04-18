import { describe, expect, it } from "vitest";
import { createMockForwardableEmail, createMockSendEmail } from "../src/email";

describe("createMockSendEmail", () => {
	it("starts with empty _sent", () => {
		const binding = createMockSendEmail();
		expect(binding._sent).toEqual([]);
	});

	it("records sent payloads from string raw", async () => {
		const binding = createMockSendEmail();
		await binding.send({ from: "a@x.com", to: "b@x.com", raw: "raw-mime" });
		expect(binding._sent).toHaveLength(1);
		expect(binding._sent[0]).toEqual({ from: "a@x.com", to: "b@x.com", raw: "raw-mime" });
	});

	it("records sent payloads from ReadableStream raw", async () => {
		const binding = createMockSendEmail();
		const stream = new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode("stream-mime"));
				c.close();
			},
		});
		await binding.send({ from: "a@x.com", to: "b@x.com", raw: stream });
		expect(binding._sent[0].raw).toBe("stream-mime");
	});

	it("accumulates multiple sends", async () => {
		const binding = createMockSendEmail();
		await binding.send({ from: "a@x.com", to: "b@x.com", raw: "1" });
		await binding.send({ from: "a@x.com", to: "c@x.com", raw: "2" });
		expect(binding._sent).toHaveLength(2);
	});
});

describe("createMockForwardableEmail", () => {
	it("applies sensible defaults", () => {
		const email = createMockForwardableEmail();
		expect(email.from).toBe("sender@example.com");
		expect(email.to).toBe("recipient@example.com");
		expect(email.rawSize).toBeGreaterThan(0);
		expect(email._rejected).toBe(false);
		expect(email._forwarded).toBe(false);
		expect(email._replied).toBe(false);
	});

	it("accepts options overrides", () => {
		const email = createMockForwardableEmail({
			from: "sender@x.com",
			to: "support@x.com",
			subject: "Help",
			text: "I need help",
		});
		expect(email.from).toBe("sender@x.com");
		expect(email.to).toBe("support@x.com");
		expect(email.headers.get("subject")).toBe("Help");
	});

	it("produces a readable raw MIME stream", async () => {
		const email = createMockForwardableEmail({ subject: "Hi", text: "Body" });
		const raw = await new Response(email.raw).text();
		expect(raw).toContain("Subject: Hi");
		expect(raw).toContain("Body");
	});

	it("setReject flips state", () => {
		const email = createMockForwardableEmail();
		email.setReject("no");
		expect(email._rejected).toBe(true);
		expect(email._rejectReason).toBe("no");
	});

	it("forward flips state", async () => {
		const email = createMockForwardableEmail();
		await email.forward("other@x.com");
		expect(email._forwarded).toBe(true);
		expect(email._forwardedTo).toBe("other@x.com");
	});

	it("reply flips state", async () => {
		const email = createMockForwardableEmail();
		await email.reply({ from: "a@x.com", to: "b@x.com", raw: "r" });
		expect(email._replied).toBe(true);
	});

	it("includes custom headers", () => {
		const email = createMockForwardableEmail({
			headers: { "x-custom": "value" },
		});
		expect(email.headers.get("x-custom")).toBe("value");
	});
});
