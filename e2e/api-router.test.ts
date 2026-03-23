import { api, createRouter } from "@workkit/api";
import { describe, expect, it } from "vitest";
import { createRequest } from "./helpers/setup";
import { createNumberSchema, createObjectSchema, createStringSchema } from "./helpers/setup";

describe("API router E2E", () => {
	describe("define APIs and route requests", () => {
		it("routes GET request to correct handler", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => {
					return [
						{ id: 1, name: "Alice" },
						{ id: 2, name: "Bob" },
					];
				},
			});

			const router = createRouter({ apis: [getUsers] });
			const req = createRequest("/users");
			const res = await router.fetch(req, {});

			expect(res.status).toBe(200);
			const body = (await res.json()) as any[];
			expect(body).toHaveLength(2);
			expect(body[0].name).toBe("Alice");
		});

		it("routes POST request with body", async () => {
			const createUser = api({
				method: "POST",
				path: "/users",
				body: createObjectSchema<{ name: string }>({
					name: createStringSchema({ minLength: 1 }),
				}),
				handler: async ({ body }) => {
					return { id: 1, name: body.name };
				},
			});

			const router = createRouter({ apis: [createUser] });
			const req = createRequest("/users", {
				method: "POST",
				body: { name: "Alice" },
			});
			const res = await router.fetch(req, {});

			expect(res.status).toBe(200);
			const body = (await res.json()) as any;
			expect(body.name).toBe("Alice");
		});

		it("routes request with path params", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				params: createObjectSchema<{ id: string }>({
					id: createStringSchema(),
				}),
				handler: async ({ params }) => {
					return { id: params.id, name: `User ${params.id}` };
				},
			});

			const router = createRouter({ apis: [getUser] });
			const req = createRequest("/users/42");
			const res = await router.fetch(req, {});

			expect(res.status).toBe(200);
			const body = (await res.json()) as any;
			expect(body.id).toBe("42");
			expect(body.name).toBe("User 42");
		});

		it("handles multiple routes", async () => {
			const listUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => ({ users: [] }),
			});

			const listPosts = api({
				method: "GET",
				path: "/posts",
				handler: async () => ({ posts: [] }),
			});

			const router = createRouter({ apis: [listUsers, listPosts] });

			const usersRes = await router.fetch(createRequest("/users"), {});
			const postsRes = await router.fetch(createRequest("/posts"), {});

			expect(((await usersRes.json()) as any).users).toBeDefined();
			expect(((await postsRes.json()) as any).posts).toBeDefined();
		});

		it("supports PUT and DELETE methods", async () => {
			const updateUser = api({
				method: "PUT",
				path: "/users/:id",
				body: createObjectSchema<{ name: string }>({
					name: createStringSchema(),
				}),
				handler: async ({ params, body }) => {
					return { id: params.id, name: body.name };
				},
			});

			const deleteUser = api({
				method: "DELETE",
				path: "/users/:id",
				handler: async ({ params }) => {
					return { deleted: true, id: params.id };
				},
			});

			const router = createRouter({ apis: [updateUser, deleteUser] });

			const putRes = await router.fetch(
				createRequest("/users/1", { method: "PUT", body: { name: "Updated" } }),
				{},
			);
			expect(putRes.status).toBe(200);
			expect(((await putRes.json()) as any).name).toBe("Updated");

			const delRes = await router.fetch(createRequest("/users/1", { method: "DELETE" }), {});
			expect(delRes.status).toBe(200);
			expect(((await delRes.json()) as any).deleted).toBe(true);
		});
	});

	describe("validates params, body, response", () => {
		it("rejects invalid body", async () => {
			const createUser = api({
				method: "POST",
				path: "/users",
				body: createObjectSchema<{ name: string }>({
					name: createStringSchema({ minLength: 1 }),
				}),
				handler: async ({ body }) => body,
			});

			const router = createRouter({ apis: [createUser] });

			// Send invalid body (missing name or empty object)
			const req = createRequest("/users", {
				method: "POST",
				body: { name: 123 }, // name should be a string
			});

			const res = await router.fetch(req, {});
			expect(res.status).toBe(400);
		});

		it("validates path params", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				params: createObjectSchema<{ id: string }>({
					id: createStringSchema({ minLength: 1 }),
				}),
				handler: async ({ params }) => ({ id: params.id }),
			});

			const router = createRouter({ apis: [getUser] });
			const req = createRequest("/users/42");
			const res = await router.fetch(req, {});
			expect(res.status).toBe(200);
		});

		it("validates response when validateResponses is enabled", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				response: createObjectSchema<{ id: string; name: string }>({
					id: createStringSchema(),
					name: createStringSchema(),
				}),
				handler: async () => {
					// Return data that does NOT match the response schema
					return { id: 123, name: "Alice" } as any;
				},
			});

			const router = createRouter({ apis: [getUser], validateResponses: true });
			const req = createRequest("/users/1");
			const res = await router.fetch(req, {});
			// Should fail because id is a number, not a string
			expect(res.status).toBe(400);
		});
	});

	describe("404 for unknown routes, 405 for wrong methods", () => {
		it("returns 404 for non-existent route", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [],
			});

			const router = createRouter({ apis: [getUsers] });
			const req = createRequest("/nonexistent");
			const res = await router.fetch(req, {});

			expect(res.status).toBe(404);
			const body = (await res.json()) as any;
			expect(body.error.code).toBe("NOT_FOUND");
		});

		it("returns 405 for wrong method on existing route", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [],
			});

			const router = createRouter({ apis: [getUsers] });
			const req = createRequest("/users", { method: "POST", body: {} });
			const res = await router.fetch(req, {});

			expect(res.status).toBe(405);
			expect(res.headers.get("Allow")).toContain("GET");
		});

		it("returns 404 for paths that partially match", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				handler: async () => ({}),
			});

			const router = createRouter({ apis: [getUser] });
			const req = createRequest("/users/1/posts");
			const res = await router.fetch(req, {});
			expect(res.status).toBe(404);
		});
	});

	describe("router features", () => {
		it("supports basePath", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [{ id: 1 }],
			});

			const router = createRouter({ apis: [getUsers], basePath: "/api/v1" });

			// With base path prefix -> 200
			const found = await router.fetch(createRequest("/api/v1/users"), {});
			expect(found.status).toBe(200);

			const body = (await found.json()) as any[];
			expect(body).toHaveLength(1);
			expect(body[0].id).toBe(1);

			// Unrelated path -> 404
			const notFound = await router.fetch(createRequest("/api/v2/users"), {});
			expect(notFound.status).toBe(404);
		});

		it("supports CORS (boolean)", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [],
			});

			const router = createRouter({ apis: [getUsers], cors: true });

			// OPTIONS preflight
			const preflightReq = new Request("http://localhost/users", {
				method: "OPTIONS",
				headers: { Origin: "http://example.com" },
			});
			const preflightRes = await router.fetch(preflightReq, {});
			expect(preflightRes.status).toBe(204);
			expect(preflightRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

			// Regular request has CORS headers
			const req = createRequest("/users", {
				headers: { Origin: "http://example.com" },
			});
			const res = await router.fetch(req, {});
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});

		it("supports custom error handler", async () => {
			const failEndpoint = api({
				method: "GET",
				path: "/fail",
				handler: async () => {
					throw new Error("Intentional failure");
				},
			});

			const router = createRouter({
				apis: [failEndpoint],
				onError: (err) => {
					return new Response(JSON.stringify({ custom: true, msg: (err as Error).message }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				},
			});

			const res = await router.fetch(createRequest("/fail"), {});
			expect(res.status).toBe(500);
			const body = (await res.json()) as any;
			expect(body.custom).toBe(true);
			expect(body.msg).toBe("Intentional failure");
		});

		it("supports global middleware", async () => {
			const getUsers = api({
				method: "GET",
				path: "/users",
				handler: async () => [{ id: 1 }],
			});

			const logs: string[] = [];

			const router = createRouter({
				apis: [getUsers],
				middleware: [
					async (req, _env, next) => {
						logs.push("before");
						const res = await next();
						logs.push("after");
						return res;
					},
				],
			});

			await router.fetch(createRequest("/users"), {});
			expect(logs).toEqual(["before", "after"]);
		});

		it("handler receives env", async () => {
			const getConfig = api({
				method: "GET",
				path: "/config",
				handler: async ({ env }) => {
					return { apiUrl: (env as any).API_URL };
				},
			});

			const router = createRouter({ apis: [getConfig] });
			const res = await router.fetch(createRequest("/config"), {
				API_URL: "https://api.example.com",
			});

			const body = (await res.json()) as any;
			expect(body.apiUrl).toBe("https://api.example.com");
		});

		it("handler can return raw Response", async () => {
			const rawEndpoint = api({
				method: "GET",
				path: "/raw",
				handler: async () => {
					return new Response("plain text", {
						status: 201,
						headers: { "X-Custom": "value" },
					});
				},
			});

			const router = createRouter({ apis: [rawEndpoint] });
			const res = await router.fetch(createRequest("/raw"), {});

			expect(res.status).toBe(201);
			expect(res.headers.get("X-Custom")).toBe("value");
			expect(await res.text()).toBe("plain text");
		});

		it("routes list is accessible", () => {
			const a = api({ method: "GET", path: "/a", handler: async () => ({}) });
			const b = api({ method: "POST", path: "/b", handler: async () => ({}) });
			const router = createRouter({ apis: [a, b] });
			expect(router.routes).toHaveLength(2);
		});
	});

	describe("api definition validation", () => {
		it("throws if method is missing", () => {
			expect(() => api({ method: "" as any, path: "/test", handler: async () => ({}) })).toThrow(
				"requires a method",
			);
		});

		it("throws if path is missing", () => {
			expect(() => api({ method: "GET", path: "" as any, handler: async () => ({}) })).toThrow(
				"requires a path",
			);
		});

		it("throws if path does not start with /", () => {
			expect(() => api({ method: "GET", path: "no-slash", handler: async () => ({}) })).toThrow(
				"start with '/'",
			);
		});

		it("throws if handler is missing", () => {
			expect(() => api({ method: "GET", path: "/test", handler: undefined as any })).toThrow(
				"requires a handler",
			);
		});

		it("throws if GET has body schema", () => {
			expect(() =>
				api({
					method: "GET",
					path: "/test",
					body: createObjectSchema<{ x: string }>({ x: createStringSchema() }),
					handler: async () => ({}),
				}),
			).toThrow("cannot have a body schema");
		});
	});
});
