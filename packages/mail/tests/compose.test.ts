import { describe, expect, it } from "vitest";
import { composeMessage } from "../src/compose";

describe("composeMessage()", () => {
	it("composes a plain text email", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body text",
		});

		expect(result.from).toBe("sender@example.com");
		expect(result.to).toBe("recipient@example.com");
		// mimetext base64-encodes the subject as =?utf-8?B?...?=
		expect(result.raw).toContain("Subject:");
		expect(result.raw).toContain("Body text");
	});

	it("composes an HTML email", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			html: "<p>Body</p>",
		});

		expect(result.raw).toContain("<p>Body</p>");
	});

	it("composes multipart (text + html)", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Plain",
			html: "<p>Rich</p>",
		});

		expect(result.raw).toContain("Plain");
		expect(result.raw).toContain("<p>Rich</p>");
	});

	it("supports EmailAddress objects for from", () => {
		const result = composeMessage({
			from: { email: "sender@example.com", name: "Sender Name" },
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body",
		});

		expect(result.from).toBe("sender@example.com");
		// mimetext base64-encodes display names, so check for the email address in From header
		expect(result.raw).toContain("sender@example.com");
		expect(result.raw).toContain("From:");
	});

	it("supports multiple recipients", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: ["a@example.com", "b@example.com"],
			subject: "Hello",
			text: "Body",
		});

		// First recipient used as envelope to
		expect(result.to).toBe("a@example.com");
		expect(result.raw).toContain("a@example.com");
		expect(result.raw).toContain("b@example.com");
	});

	it("includes cc and bcc", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body",
			cc: "cc@example.com",
			bcc: "bcc@example.com",
		});

		expect(result.raw).toContain("cc@example.com");
	});

	it("includes reply-to header", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body",
			replyTo: "reply@example.com",
		});

		expect(result.raw).toContain("reply@example.com");
	});

	it("includes custom X- headers", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body",
			headers: { "X-Custom": "value123" },
		});

		expect(result.raw).toContain("X-Custom");
		expect(result.raw).toContain("value123");
	});

	it("includes attachments", () => {
		const result = composeMessage({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Hello",
			text: "Body",
			attachments: [
				{
					filename: "test.txt",
					content: "file content",
					contentType: "text/plain",
				},
			],
		});

		expect(result.raw).toContain("test.txt");
	});
});
