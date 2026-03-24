import { describe, expect, it } from "vitest";
import { parseEmail } from "../src/parser";

const SIMPLE_EMAIL = [
	"From: sender@example.com",
	"To: recipient@example.com",
	"Subject: Test Subject",
	"Date: Mon, 25 Mar 2026 10:00:00 +0000",
	"Message-ID: <test-123@example.com>",
	"MIME-Version: 1.0",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Hello, world!",
].join("\r\n");

const HTML_EMAIL = [
	"From: sender@example.com",
	"To: recipient@example.com",
	"Subject: HTML Test",
	"MIME-Version: 1.0",
	"Content-Type: text/html; charset=utf-8",
	"",
	"<p>Hello!</p>",
].join("\r\n");

const REPLY_EMAIL = [
	"From: sender@example.com",
	"To: recipient@example.com",
	"Subject: Re: Original",
	"In-Reply-To: <original-123@example.com>",
	"References: <original-123@example.com>",
	"MIME-Version: 1.0",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"This is a reply.",
].join("\r\n");

describe("parseEmail()", () => {
	it("parses a simple plain text email", async () => {
		const parsed = await parseEmail(SIMPLE_EMAIL);

		expect(parsed.subject).toBe("Test Subject");
		expect(parsed.from).toBe("sender@example.com");
		expect(parsed.to).toContain("recipient@example.com");
		expect(parsed.text).toBe("Hello, world!");
		expect(parsed.messageId).toBe("<test-123@example.com>");
	});

	it("parses an HTML email", async () => {
		const parsed = await parseEmail(HTML_EMAIL);

		expect(parsed.subject).toBe("HTML Test");
		expect(parsed.html).toContain("<p>Hello!</p>");
	});

	it("parses threading headers", async () => {
		const parsed = await parseEmail(REPLY_EMAIL);

		expect(parsed.inReplyTo).toBe("<original-123@example.com>");
		expect(parsed.references).toContain("<original-123@example.com>");
	});

	it("accepts ArrayBuffer input", async () => {
		const buffer = new TextEncoder().encode(SIMPLE_EMAIL).buffer;
		const parsed = await parseEmail(buffer);

		expect(parsed.subject).toBe("Test Subject");
	});

	it("accepts ReadableStream input", async () => {
		const bytes = new TextEncoder().encode(SIMPLE_EMAIL);
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		});
		const parsed = await parseEmail(stream);

		expect(parsed.subject).toBe("Test Subject");
	});

	it("returns empty attachments for a simple email", async () => {
		const parsed = await parseEmail(SIMPLE_EMAIL);
		expect(parsed.attachments).toEqual([]);
	});
});
