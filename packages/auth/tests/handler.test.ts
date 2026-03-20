import { describe, expect, it, vi } from "vitest";
import { createAuthHandler } from "../src/handler";

type TestAuth = { sub: string; role: string };

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request("https://example.com/api", { headers });
}

const mockCtx = {
	waitUntil: vi.fn(),
	passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

describe("createAuthHandler", () => {
	describe("required", () => {
		it("calls handler with auth context when verified", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "admin" }),
			});

			const handler = auth.required(async (_req, _env, _ctx, authCtx) => {
				return new Response(JSON.stringify(authCtx));
			});

			const response = await handler(makeRequest(), {}, mockCtx);
			const body = (await response.json()) as TestAuth;

			expect(response.status).toBe(200);
			expect(body.sub).toBe("user:1");
			expect(body.role).toBe("admin");
		});

		it("returns 401 when verify returns null", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
			});

			const handler = auth.required(async () => new Response("OK"));
			const response = await handler(makeRequest(), {}, mockCtx);

			expect(response.status).toBe(401);
		});

		it("uses custom unauthorized response", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
				unauthorized: () => new Response("Custom 401", { status: 401 }),
			});

			const handler = auth.required(async () => new Response("OK"));
			const response = await handler(makeRequest(), {}, mockCtx);
			const body = await response.text();

			expect(response.status).toBe(401);
			expect(body).toBe("Custom 401");
		});

		it("passes request and env to verify", async () => {
			const verifySpy = vi.fn(async () => ({ sub: "user:1", role: "user" }));
			const auth = createAuthHandler<TestAuth>({ verify: verifySpy });

			const req = makeRequest({ Authorization: "Bearer token123" });
			const env = { JWT_SECRET: "secret" };
			const handler = auth.required(async () => new Response("OK"));

			await handler(req, env, mockCtx);

			expect(verifySpy).toHaveBeenCalledWith(req, env);
		});

		it("does not call handler when auth fails", async () => {
			const handlerFn = vi.fn(async () => new Response("OK"));
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
			});

			const handler = auth.required(handlerFn);
			await handler(makeRequest(), {}, mockCtx);

			expect(handlerFn).not.toHaveBeenCalled();
		});
	});

	describe("optional", () => {
		it("passes auth context when authenticated", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "admin" }),
			});

			const handler = auth.optional(async (_req, _env, _ctx, authCtx) => {
				return new Response(authCtx ? authCtx.sub : "anonymous");
			});

			const response = await handler(makeRequest(), {}, mockCtx);
			const body = await response.text();

			expect(body).toBe("user:1");
		});

		it("passes null when not authenticated", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
			});

			const handler = auth.optional(async (_req, _env, _ctx, authCtx) => {
				return new Response(authCtx ? authCtx.sub : "anonymous");
			});

			const response = await handler(makeRequest(), {}, mockCtx);
			const body = await response.text();

			expect(body).toBe("anonymous");
		});

		it("always calls handler regardless of auth", async () => {
			const handlerFn = vi.fn(async () => new Response("OK"));
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
			});

			const handler = auth.optional(handlerFn);
			await handler(makeRequest(), {}, mockCtx);

			expect(handlerFn).toHaveBeenCalledOnce();
		});
	});

	describe("requireRole", () => {
		it("allows matching role", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "admin" }),
			});

			const handler = auth.requireRole("admin", async (_req, _env, _ctx, authCtx) => {
				return new Response(`Hello ${authCtx.sub}`);
			});

			const response = await handler(makeRequest(), {}, mockCtx);
			const body = await response.text();

			expect(response.status).toBe(200);
			expect(body).toBe("Hello user:1");
		});

		it("returns 403 for wrong role", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "user" }),
			});

			const handler = auth.requireRole("admin", async () => new Response("OK"));
			const response = await handler(makeRequest(), {}, mockCtx);

			expect(response.status).toBe(403);
		});

		it("returns 401 when not authenticated", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => null,
			});

			const handler = auth.requireRole("admin", async () => new Response("OK"));
			const response = await handler(makeRequest(), {}, mockCtx);

			expect(response.status).toBe(401);
		});

		it("uses custom forbidden response", async () => {
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "user" }),
				forbidden: () => new Response("Nope", { status: 403 }),
			});

			const handler = auth.requireRole("admin", async () => new Response("OK"));
			const response = await handler(makeRequest(), {}, mockCtx);
			const body = await response.text();

			expect(response.status).toBe(403);
			expect(body).toBe("Nope");
		});

		it("does not call handler when role mismatches", async () => {
			const handlerFn = vi.fn(async () => new Response("OK"));
			const auth = createAuthHandler<TestAuth>({
				verify: async () => ({ sub: "user:1", role: "user" }),
			});

			const handler = auth.requireRole("admin", handlerFn);
			await handler(makeRequest(), {}, mockCtx);

			expect(handlerFn).not.toHaveBeenCalled();
		});
	});
});
