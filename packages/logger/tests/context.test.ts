import { describe, expect, it } from "vitest";
import { getRequestContext, runWithContext } from "../src/context";
import type { RequestContext } from "../src/types";

describe("AsyncLocalStorage context", () => {
	it("returns undefined outside of context", () => {
		expect(getRequestContext()).toBeUndefined();
	});

	it("returns context within runWithContext", async () => {
		const ctx: RequestContext = {
			requestId: "abc-123",
			method: "GET",
			path: "/users",
			startTime: Date.now(),
			fields: {},
		};

		await runWithContext(ctx, async () => {
			const result = getRequestContext();
			expect(result).toBeDefined();
			expect(result!.requestId).toBe("abc-123");
			expect(result!.method).toBe("GET");
			expect(result!.path).toBe("/users");
		});
	});

	it("context is isolated between runs", async () => {
		const ctx1: RequestContext = {
			requestId: "req-1",
			method: "GET",
			path: "/a",
			startTime: Date.now(),
			fields: {},
		};
		const ctx2: RequestContext = {
			requestId: "req-2",
			method: "POST",
			path: "/b",
			startTime: Date.now(),
			fields: {},
		};

		await Promise.all([
			runWithContext(ctx1, async () => {
				await new Promise((r) => setTimeout(r, 10));
				expect(getRequestContext()!.requestId).toBe("req-1");
			}),
			runWithContext(ctx2, async () => {
				expect(getRequestContext()!.requestId).toBe("req-2");
			}),
		]);
	});

	it("context is undefined after runWithContext completes", async () => {
		const ctx: RequestContext = {
			requestId: "temp",
			method: "GET",
			path: "/",
			startTime: Date.now(),
			fields: {},
		};

		await runWithContext(ctx, async () => {
			expect(getRequestContext()).toBeDefined();
		});

		expect(getRequestContext()).toBeUndefined();
	});
});
