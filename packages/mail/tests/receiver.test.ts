import { createMockForwardableEmail } from "@workkit/testing";
import { describe, expect, it, vi } from "vitest";
import { createEmailHandler } from "../src/receiver";

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

describe("createEmailHandler()", () => {
	it("creates a handler function", () => {
		const handler = createEmailHandler({
			handler: async () => {},
		});
		expect(typeof handler).toBe("function");
	});

	it("calls handler with parsed InboundEmail", async () => {
		const handlerFn = vi.fn();
		const handler = createEmailHandler({ handler: handlerFn });
		const mockEmail = createMockForwardableEmail({
			from: "sender@test.com",
			to: "recipient@test.com",
			subject: "Test",
			text: "Hello",
		});

		await handler(mockEmail as any, {}, ctx);

		expect(handlerFn).toHaveBeenCalledOnce();
		const inbound = handlerFn.mock.calls[0][0];
		expect(inbound.from).toBe("sender@test.com");
		expect(inbound.to).toBe("recipient@test.com");
		expect(inbound.subject).toBe("Test");
	});

	it("exposes forward() on InboundEmail", async () => {
		const mockEmail = createMockForwardableEmail();
		let forwardCalled = false;

		const handler = createEmailHandler({
			handler: async (email) => {
				await email.forward("admin@example.com");
				forwardCalled = true;
			},
		});

		await handler(mockEmail as any, {}, ctx);
		expect(forwardCalled).toBe(true);
		expect(mockEmail._forwarded).toBe(true);
		expect(mockEmail._forwardedTo).toBe("admin@example.com");
	});

	it("exposes reply() on InboundEmail", async () => {
		const mockEmail = createMockForwardableEmail({
			from: "sender@test.com",
			to: "recipient@test.com",
			subject: "Original",
		});

		const handler = createEmailHandler({
			handler: async (email) => {
				await email.reply({
					from: "recipient@test.com",
					text: "Got it, thanks!",
				});
			},
		});

		await handler(mockEmail as any, {}, ctx);
		expect(mockEmail._replied).toBe(true);
	});

	it("exposes setReject() on InboundEmail", async () => {
		const mockEmail = createMockForwardableEmail();

		const handler = createEmailHandler({
			handler: async (email) => {
				email.setReject("Unauthorized");
			},
		});

		await handler(mockEmail as any, {}, ctx);
		expect(mockEmail._rejected).toBe(true);
		expect(mockEmail._rejectReason).toBe("Unauthorized");
	});

	it("calls onError when handler throws", async () => {
		const onError = vi.fn();
		const handler = createEmailHandler({
			handler: async () => {
				throw new Error("Handler failed");
			},
			onError,
		});
		const mockEmail = createMockForwardableEmail();

		await handler(mockEmail as any, {}, ctx);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
	});

	it("rethrows when no onError provided", async () => {
		const handler = createEmailHandler({
			handler: async () => {
				throw new Error("Handler failed");
			},
		});
		const mockEmail = createMockForwardableEmail();

		await expect(handler(mockEmail as any, {}, ctx)).rejects.toThrow("Handler failed");
	});
});
