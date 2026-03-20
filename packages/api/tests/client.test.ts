import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClientError, createClient } from "../src/client";
import { api } from "../src/define";

describe("createClient", () => {
	it("makes GET requests", async () => {
		const getUsers = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([{ id: "1" }]), {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		const result = await client.call(getUsers);
		expect(result).toEqual([{ id: "1" }]);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.example.com/users",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("interpolates path parameters", async () => {
		const getUser = api({
			method: "GET",
			path: "/users/:id",
			handler: async () => ({}),
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: "123" }), {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		await client.call(getUser, { params: { id: "123" } });
		expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/users/123", expect.any(Object));
	});

	it("sends query parameters", async () => {
		const listUsers = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		await client.call(listUsers, { query: { limit: "10", offset: "0" } });
		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.example.com/users?limit=10&offset=0",
			expect.any(Object),
		);
	});

	it("sends POST body as JSON", async () => {
		const createUser = api({
			method: "POST",
			path: "/users",
			body: z.object({ name: z.string() }),
			handler: async () => ({ id: "1" }),
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: "1" }), {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		await client.call(createUser, { body: { name: "Alice" } });

		const [, init] = mockFetch.mock.calls[0];
		expect(init.method).toBe("POST");
		expect(init.body).toBe(JSON.stringify({ name: "Alice" }));
		expect(init.headers["Content-Type"]).toBe("application/json");
	});

	it("includes default headers", async () => {
		const getUsers = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response("[]", {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			headers: { Authorization: "Bearer token123" },
			fetch: mockFetch,
		});

		await client.call(getUsers);
		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers.Authorization).toBe("Bearer token123");
	});

	it("allows per-call headers", async () => {
		const getUsers = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response("[]", {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		await client.call(getUsers, { headers: { "X-Custom": "value" } });
		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers["X-Custom"]).toBe("value");
	});

	it("throws ApiClientError on non-ok responses", async () => {
		const getUser = api({
			method: "GET",
			path: "/users/:id",
			handler: async () => ({}),
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "User not found" } }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		try {
			await client.call(getUser, { params: { id: "999" } });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiClientError);
			const e = err as ApiClientError;
			expect(e.status).toBe(404);
			expect(e.body).toEqual({
				error: { code: "NOT_FOUND", message: "User not found" },
			});
		}
	});

	it("handles 204 no content", async () => {
		const deleteUser = api({
			method: "DELETE",
			path: "/users/:id",
			handler: async () => undefined as any,
		});

		const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		const result = await client.call(deleteUser, { params: { id: "123" } });
		expect(result).toBeUndefined();
	});

	it("handles non-JSON responses", async () => {
		const getHealth = api({
			method: "GET",
			path: "/health",
			handler: async () => "ok" as any,
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response("OK", {
				status: 200,
				headers: { "Content-Type": "text/plain" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com",
			fetch: mockFetch,
		});

		const result = await client.call(getHealth);
		expect(result).toBe("OK");
	});

	it("handles trailing slash in baseUrl", async () => {
		const getUsers = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response("[]", {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const client = createClient({
			baseUrl: "https://api.example.com/",
			fetch: mockFetch,
		});

		await client.call(getUsers);
		expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/users", expect.any(Object));
	});

	describe("for()", () => {
		it("creates a pre-bound caller", async () => {
			const getUser = api({
				method: "GET",
				path: "/users/:id",
				handler: async () => ({}),
			});

			const mockFetch = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ id: "1", name: "Alice" }), {
					headers: { "Content-Type": "application/json" },
				}),
			);

			const client = createClient({
				baseUrl: "https://api.example.com",
				fetch: mockFetch,
			});

			const fetchUser = client.for(getUser);
			const result = await fetchUser({ params: { id: "1" } });
			expect(result).toEqual({ id: "1", name: "Alice" });
		});
	});
});
