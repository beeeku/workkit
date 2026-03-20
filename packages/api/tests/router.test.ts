import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api } from "../src/define";
import { createRouter } from "../src/router";

// Helper to create a Request
function makeRequest(
	method: string,
	path: string,
	options?: { body?: unknown; headers?: Record<string, string> },
): Request {
	const url = `http://localhost${path}`;
	const init: RequestInit = { method };

	if (options?.body) {
		init.body = JSON.stringify(options.body);
		init.headers = { "Content-Type": "application/json", ...options?.headers };
	} else if (options?.headers) {
		init.headers = options.headers;
	}

	return new Request(url, init);
}

describe("createRouter", () => {
	describe("routing", () => {
		it("routes GET requests to matching handlers", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [{ id: "1", name: "Alice" }],
			});

			const router = createRouter({ apis: [getUsers] });
			const res = await router.fetch(makeRequest("GET", "/users"), {});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual([{ id: "1", name: "Alice" }]);
		});

		it("routes POST requests with body validation", async () => {
			const createUser = api({
				method: "POST",
				path: "/users",
				body: z.object({ name: z.string().min(1), email: z.string().email() }),
				response: z.object({ id: z.string() }),
				handler: async ({ body }) => ({ id: "123" }),
			});

			const router = createRouter({ apis: [createUser] });
			const res = await router.fetch(
				makeRequest("POST", "/users", {
					body: { name: "Alice", email: "alice@example.com" },
				}),
				{},
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: "123" });
		});

		it("routes to correct handler among multiple routes", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => ({ type: "list" }),
			});
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				handler: async ({ params }) => ({ type: "single", id: params.id }),
			});

			const router = createRouter({ apis: [getUsers, getUser] });

			const res1 = await router.fetch(makeRequest("GET", "/users"), {});
			expect(await res1.json()).toEqual({ type: "list" });

			const res2 = await router.fetch(makeRequest("GET", "/users/123"), {});
			expect(await res2.json()).toEqual({ type: "single", id: "123" });
		});

		it("extracts path parameters", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				handler: async ({ params }) => ({ id: params.id }),
			});

			const router = createRouter({ apis: [getUser] });
			const res = await router.fetch(makeRequest("GET", "/users/abc"), {});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: "abc" });
		});

		it("extracts multiple path parameters", async () => {
			const getComment = api({
				method: "GET",
				path: "/users/:userId/posts/:postId",
				handler: async ({ params }) => ({
					userId: params.userId,
					postId: params.postId,
				}),
			});

			const router = createRouter({ apis: [getComment] });
			const res = await router.fetch(makeRequest("GET", "/users/u1/posts/p2"), {});

			expect(await res.json()).toEqual({ userId: "u1", postId: "p2" });
		});
	});

	describe("404 handling", () => {
		it("returns 404 for unmatched routes", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
			});

			const res = await router.fetch(makeRequest("GET", "/nonexistent"), {});
			expect(res.status).toBe(404);

			const body = await res.json();
			expect(body.error.code).toBe("NOT_FOUND");
		});

		it("returns 405 for wrong method on existing path", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
			});

			const res = await router.fetch(makeRequest("POST", "/users"), {});
			expect(res.status).toBe(405);
			expect(res.headers.get("Allow")).toBe("GET");
		});

		it("includes multiple allowed methods in Allow header", async () => {
			const router = createRouter({
				apis: [
					api({ method: "GET", path: "/users", handler: async () => [] }),
					api({
						method: "POST",
						path: "/users",
						body: z.object({ name: z.string() }),
						handler: async () => ({ id: "1" }),
					}),
				],
			});

			const res = await router.fetch(makeRequest("DELETE", "/users"), {});
			expect(res.status).toBe(405);
			const allow = res.headers.get("Allow");
			expect(allow).toContain("GET");
			expect(allow).toContain("POST");
		});
	});

	describe("validation errors", () => {
		it("returns 400 for invalid body", async () => {
			const createUser = api({
				method: "POST",
				path: "/users",
				body: z.object({ name: z.string().min(1), email: z.string().email() }),
				handler: async () => ({ id: "1" }),
			});

			const router = createRouter({ apis: [createUser] });
			const res = await router.fetch(
				makeRequest("POST", "/users", {
					body: { name: "", email: "not-an-email" },
				}),
				{},
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_VALIDATION");
		});

		it("returns 400 for invalid JSON body", async () => {
			const createUser = api({
				method: "POST",
				path: "/users",
				body: z.object({ name: z.string() }),
				handler: async () => ({ id: "1" }),
			});

			const router = createRouter({ apis: [createUser] });
			const req = new Request("http://localhost/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not json{{{",
			});
			const res = await router.fetch(req, {});

			expect(res.status).toBe(400);
		});

		it("returns 400 for invalid query parameters", async () => {
			const listUsers = api({
				method: "GET",
				path: "/users",
				query: z.object({ limit: z.string().regex(/^\d+$/) }),
				handler: async () => [],
			});

			const router = createRouter({ apis: [listUsers] });
			const res = await router.fetch(makeRequest("GET", "/users?limit=abc"), {});

			expect(res.status).toBe(400);
		});

		it("returns 400 for invalid path parameters", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				params: z.object({ id: z.string().uuid() }),
				handler: async ({ params }) => ({ id: params.id }),
			});

			const router = createRouter({ apis: [getUser] });
			const res = await router.fetch(makeRequest("GET", "/users/not-a-uuid"), {});

			expect(res.status).toBe(400);
		});
	});

	describe("error handling", () => {
		it("returns 500 for handler errors", async () => {
			const broken = api({
				method: "GET",
				path: "/fail",
				handler: async () => {
					throw new Error("Something went wrong");
				},
			});

			const router = createRouter({ apis: [broken] });
			const res = await router.fetch(makeRequest("GET", "/fail"), {});

			expect(res.status).toBe(500);
			const body = await res.json();
			expect(body.error.code).toBe("INTERNAL_ERROR");
		});

		it("uses custom error handler", async () => {
			const broken = api({
				method: "GET",
				path: "/fail",
				handler: async () => {
					throw new Error("oops");
				},
			});

			const router = createRouter({
				apis: [broken],
				onError: (err) => new Response("custom error", { status: 503 }),
			});

			const res = await router.fetch(makeRequest("GET", "/fail"), {});
			expect(res.status).toBe(503);
			expect(await res.text()).toBe("custom error");
		});

		it("falls back to default error handling if custom handler throws", async () => {
			const broken = api({
				method: "GET",
				path: "/fail",
				handler: async () => {
					throw new Error("original");
				},
			});

			const router = createRouter({
				apis: [broken],
				onError: () => {
					throw new Error("custom handler also broke");
				},
			});

			const res = await router.fetch(makeRequest("GET", "/fail"), {});
			expect(res.status).toBe(500);
		});
	});

	describe("basePath", () => {
		it("strips basePath from route matching", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [{ id: "1" }],
			});

			const router = createRouter({ apis: [getUsers], basePath: "/api/v1" });
			const res = await router.fetch(makeRequest("GET", "/api/v1/users"), {});

			expect(res.status).toBe(200);
		});

		it("handles trailing slash in basePath", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [],
			});

			const router = createRouter({ apis: [getUsers], basePath: "/api/" });
			const res = await router.fetch(makeRequest("GET", "/api/users"), {});

			expect(res.status).toBe(200);
		});
	});

	describe("CORS", () => {
		it("responds to OPTIONS preflight with cors: true", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
				cors: true,
			});

			const res = await router.fetch(
				makeRequest("OPTIONS", "/users", {
					headers: { Origin: "http://example.com" },
				}),
				{},
			);

			expect(res.status).toBe(204);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
		});

		it("adds CORS headers to normal responses", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
				cors: true,
			});

			const res = await router.fetch(
				makeRequest("GET", "/users", {
					headers: { Origin: "http://example.com" },
				}),
				{},
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});

		it("supports custom CORS config", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
				cors: {
					origin: "http://allowed.com",
					methods: ["GET"],
					credentials: true,
				},
			});

			const res = await router.fetch(
				makeRequest("OPTIONS", "/users", {
					headers: { Origin: "http://example.com" },
				}),
				{},
			);

			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://allowed.com");
			expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		});

		it("supports origin array", async () => {
			const router = createRouter({
				apis: [api({ method: "GET", path: "/users", handler: async () => [] })],
				cors: {
					origin: ["http://a.com", "http://b.com"],
				},
			});

			const res = await router.fetch(
				makeRequest("GET", "/users", {
					headers: { Origin: "http://b.com" },
				}),
				{},
			);

			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://b.com");
		});
	});

	describe("middleware", () => {
		it("executes global middleware", async () => {
			const log: string[] = [];

			const router = createRouter({
				apis: [
					api({
						method: "GET",
						path: "/users",
						handler: async () => {
							log.push("handler");
							return [];
						},
					}),
				],
				middleware: [
					async (req, env, next) => {
						log.push("before");
						const res = await next();
						log.push("after");
						return res;
					},
				],
			});

			await router.fetch(makeRequest("GET", "/users"), {});
			expect(log).toEqual(["before", "handler", "after"]);
		});

		it("executes route-level middleware", async () => {
			const log: string[] = [];

			const router = createRouter({
				apis: [
					api({
						method: "GET",
						path: "/users",
						middleware: [
							async (req, env, next) => {
								log.push("route-mw");
								return next();
							},
						],
						handler: async () => {
							log.push("handler");
							return [];
						},
					}),
				],
			});

			await router.fetch(makeRequest("GET", "/users"), {});
			expect(log).toEqual(["route-mw", "handler"]);
		});

		it("runs global middleware before route middleware", async () => {
			const log: string[] = [];

			const router = createRouter({
				apis: [
					api({
						method: "GET",
						path: "/users",
						middleware: [
							async (req, env, next) => {
								log.push("route");
								return next();
							},
						],
						handler: async () => {
							log.push("handler");
							return [];
						},
					}),
				],
				middleware: [
					async (req, env, next) => {
						log.push("global");
						return next();
					},
				],
			});

			await router.fetch(makeRequest("GET", "/users"), {});
			expect(log).toEqual(["global", "route", "handler"]);
		});

		it("allows middleware to short-circuit", async () => {
			const router = createRouter({
				apis: [
					api({
						method: "GET",
						path: "/users",
						handler: async () => [],
					}),
				],
				middleware: [async () => new Response("blocked", { status: 403 })],
			});

			const res = await router.fetch(makeRequest("GET", "/users"), {});
			expect(res.status).toBe(403);
			expect(await res.text()).toBe("blocked");
		});
	});

	describe("handler returning Response", () => {
		it("passes through Response objects from handler", async () => {
			const endpoint = api({
				method: "GET",
				path: "/custom",
				handler: async () =>
					new Response("raw", {
						status: 201,
						headers: { "X-Custom": "yes" },
					}) as any,
			});

			const router = createRouter({ apis: [endpoint] });
			const res = await router.fetch(makeRequest("GET", "/custom"), {});

			expect(res.status).toBe(201);
			expect(res.headers.get("X-Custom")).toBe("yes");
			expect(await res.text()).toBe("raw");
		});
	});

	describe("routes property", () => {
		it("exposes registered routes", () => {
			const a = api({ method: "GET", path: "/a", handler: async () => "a" });
			const b = api({
				method: "POST",
				path: "/b",
				body: z.object({ x: z.number() }),
				handler: async () => "b",
			});

			const router = createRouter({ apis: [a, b] });
			expect(router.routes).toHaveLength(2);
			expect(router.routes[0].path).toBe("/a");
			expect(router.routes[1].path).toBe("/b");
		});
	});

	describe("content type handling", () => {
		it("parses form-urlencoded bodies", async () => {
			const endpoint = api({
				method: "POST",
				path: "/form",
				body: z.object({ name: z.string() }),
				handler: async ({ body }) => body,
			});

			const router = createRouter({ apis: [endpoint] });
			const req = new Request("http://localhost/form", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: "name=Alice",
			});
			const res = await router.fetch(req, {});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ name: "Alice" });
		});
	});

	describe("response validation", () => {
		it("validates response when validateResponses is true", async () => {
			const endpoint = api({
				method: "GET",
				path: "/users",
				response: z.object({ id: z.string() }),
				handler: async () => ({ id: 123 }), // wrong type
			});

			const router = createRouter({
				apis: [endpoint],
				validateResponses: true,
			});

			const res = await router.fetch(makeRequest("GET", "/users"), {});
			expect(res.status).toBe(400); // validation error
		});
	});
});
