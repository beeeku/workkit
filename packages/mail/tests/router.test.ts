import { createMockForwardableEmail } from "@workkit/testing";
import { describe, expect, it, vi } from "vitest";
import { createEmailRouter } from "../src/router";

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

describe("createEmailRouter()", () => {
	it("returns an EmailRouter with match, default, and handle", () => {
		const router = createEmailRouter();
		expect(typeof router.match).toBe("function");
		expect(typeof router.default).toBe("function");
		expect(typeof router.handle).toBe("function");
	});

	it("routes to matching handler", async () => {
		const supportHandler = vi.fn();
		const router = createEmailRouter().match(
			(email) => email.to.startsWith("support"),
			supportHandler,
		);

		const mockEmail = createMockForwardableEmail({
			to: "support@example.com",
		});

		await router.handle(mockEmail as any, {}, ctx);
		expect(supportHandler).toHaveBeenCalledOnce();
	});

	it("routes to first matching handler only", async () => {
		const firstHandler = vi.fn();
		const secondHandler = vi.fn();
		const router = createEmailRouter()
			.match(() => true, firstHandler)
			.match(() => true, secondHandler);

		const mockEmail = createMockForwardableEmail();

		await router.handle(mockEmail as any, {}, ctx);
		expect(firstHandler).toHaveBeenCalledOnce();
		expect(secondHandler).not.toHaveBeenCalled();
	});

	it("routes to default handler when no match", async () => {
		const defaultHandler = vi.fn();
		const router = createEmailRouter()
			.match((email) => email.to.startsWith("vip"), vi.fn())
			.default(defaultHandler);

		const mockEmail = createMockForwardableEmail({
			to: "random@example.com",
		});

		await router.handle(mockEmail as any, {}, ctx);
		expect(defaultHandler).toHaveBeenCalledOnce();
	});

	it("rejects email when no match and no default", async () => {
		const router = createEmailRouter().match((email) => email.to.startsWith("vip"), vi.fn());

		const mockEmail = createMockForwardableEmail({
			to: "random@example.com",
		});

		await router.handle(mockEmail as any, {}, ctx);
		expect(mockEmail._rejected).toBe(true);
	});

	it("is chainable (fluent API)", () => {
		const router = createEmailRouter()
			.match(() => true, vi.fn())
			.match(() => false, vi.fn())
			.default(vi.fn());

		expect(typeof router.handle).toBe("function");
	});

	it("passes env and ctx to handler", async () => {
		const handler = vi.fn();
		const router = createEmailRouter().match(() => true, handler);

		const mockEmail = createMockForwardableEmail();
		const env = { DB: "test" };

		await router.handle(mockEmail as any, env, ctx);
		expect(handler.mock.calls[0][1]).toBe(env);
		expect(handler.mock.calls[0][2]).toBe(ctx);
	});
});
