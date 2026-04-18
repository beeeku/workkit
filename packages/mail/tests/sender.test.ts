import { BindingNotFoundError } from "@workkit/errors";
import { createMockSendEmail } from "@workkit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { DeliveryError, InvalidAddressError } from "../src/errors";
import { mail } from "../src/sender";

describe("mail() factory", () => {
	it("throws BindingNotFoundError for null binding", () => {
		expect(() => mail(null as any)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for undefined binding", () => {
		expect(() => mail(undefined as any)).toThrow(BindingNotFoundError);
	});

	it("creates a TypedMailClient", () => {
		const mock = createMockSendEmail();
		const client = mail(mock as any);
		expect(client).toBeDefined();
		expect(typeof client.send).toBe("function");
	});

	it("exposes .raw as the original binding", () => {
		const mock = createMockSendEmail();
		const client = mail(mock as any);
		expect(client.raw).toBe(mock);
	});
});

describe("send()", () => {
	let mock: ReturnType<typeof createMockSendEmail>;
	let client: ReturnType<typeof mail>;

	beforeEach(() => {
		mock = createMockSendEmail();
		client = mail(mock as any);
	});

	it("sends a plain text email", async () => {
		const result = await client.send({
			to: "user@example.com",
			from: "sender@example.com",
			subject: "Hello",
			text: "Body",
		});

		expect(mock._sent).toHaveLength(1);
		expect(mock._sent[0].from).toBe("sender@example.com");
		expect(mock._sent[0].to).toBe("user@example.com");
		expect(result.messageId).toBeDefined();
	});

	it("sends an HTML email", async () => {
		await client.send({
			to: "user@example.com",
			from: "sender@example.com",
			subject: "Hello",
			html: "<p>Body</p>",
		});

		expect(mock._sent).toHaveLength(1);
		expect(mock._sent[0].raw).toContain("<p>Body</p>");
	});

	it("uses defaultFrom when from is not specified", async () => {
		const clientWithDefault = mail(mock as any, {
			defaultFrom: "default@example.com",
		});

		await clientWithDefault.send({
			to: "user@example.com",
			subject: "Hello",
			text: "Body",
		});

		expect(mock._sent[0].from).toBe("default@example.com");
	});

	it("throws InvalidAddressError for invalid recipient", async () => {
		await expect(
			client.send({
				to: "not-an-email",
				from: "sender@example.com",
				subject: "Hello",
				text: "Body",
			}),
		).rejects.toThrow(InvalidAddressError);
	});

	it("sends to multiple recipients (first as envelope)", async () => {
		await client.send({
			to: ["a@example.com", "b@example.com"],
			from: "sender@example.com",
			subject: "Hello",
			text: "Body",
		});

		expect(mock._sent).toHaveLength(1);
		expect(mock._sent[0].to).toBe("a@example.com");
	});

	it("validates sender address", async () => {
		await expect(
			client.send({
				to: "user@example.com",
				from: "bad-from",
				subject: "Hello",
				text: "Body",
			}),
		).rejects.toThrow(InvalidAddressError);
	});

	it("wraps binding errors in DeliveryError", async () => {
		const failingMock = {
			async send() {
				throw new Error("Network failure");
			},
		};
		const failClient = mail(failingMock as any);

		await expect(
			failClient.send({
				to: "user@example.com",
				from: "sender@example.com",
				subject: "Hello",
				text: "Body",
			}),
		).rejects.toThrow(DeliveryError);
	});
});
