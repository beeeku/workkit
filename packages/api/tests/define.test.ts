import { describe, expect, it } from "vitest";
import { z } from "zod";
import { api, isApiDefinition } from "../src/define";

describe("api()", () => {
	it("creates an API definition with basic config", () => {
		const def = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});

		expect(def.__brand).toBe("ApiDefinition");
		expect(def.method).toBe("GET");
		expect(def.path).toBe("/users");
		expect(def.middleware).toEqual([]);
	});

	it("creates an API definition with schemas", () => {
		const def = api({
			method: "POST",
			path: "/users",
			body: z.object({ name: z.string() }),
			response: z.object({ id: z.string() }),
			handler: async ({ body }) => ({ id: "123" }),
		});

		expect(def.body).toBeDefined();
		expect(def.response).toBeDefined();
		expect(def.method).toBe("POST");
	});

	it("creates an API definition with params schema", () => {
		const def = api({
			method: "GET",
			path: "/users/:id",
			params: z.object({ id: z.string() }),
			handler: async ({ params }) => ({ id: params.id }),
		});

		expect(def.params).toBeDefined();
	});

	it("creates an API definition with query schema", () => {
		const def = api({
			method: "GET",
			path: "/users",
			query: z.object({ limit: z.string() }),
			handler: async () => [],
		});

		expect(def.query).toBeDefined();
	});

	it("creates an API definition with middleware", () => {
		const authMiddleware = async (req: Request, env: unknown, next: () => any) => next();

		const def = api({
			method: "GET",
			path: "/users",
			middleware: [authMiddleware],
			handler: async () => [],
		});

		expect(def.middleware).toHaveLength(1);
	});

	it("throws if method is missing", () => {
		expect(() =>
			api({
				method: "" as any,
				path: "/users",
				handler: async () => [],
			}),
		).toThrow("API definition requires a method");
	});

	it("throws if path is missing", () => {
		expect(() =>
			api({
				method: "GET",
				path: "" as any,
				handler: async () => [],
			}),
		).toThrow("API definition requires a path");
	});

	it("throws if path does not start with /", () => {
		expect(() =>
			api({
				method: "GET",
				path: "users" as any,
				handler: async () => [],
			}),
		).toThrow("API path must start with '/'");
	});

	it("throws if handler is missing", () => {
		expect(() =>
			api({
				method: "GET",
				path: "/users",
				handler: undefined as any,
			}),
		).toThrow("API definition requires a handler");
	});

	it("throws if GET has body schema", () => {
		expect(() =>
			api({
				method: "GET",
				path: "/users",
				body: z.object({ name: z.string() }),
				handler: async () => [],
			}),
		).toThrow("GET endpoints cannot have a body schema");
	});

	it("throws if HEAD has body schema", () => {
		expect(() =>
			api({
				method: "HEAD",
				path: "/users",
				body: z.object({}),
				handler: async () => [],
			}),
		).toThrow("HEAD endpoints cannot have a body schema");
	});

	it("allows POST with body schema", () => {
		const def = api({
			method: "POST",
			path: "/users",
			body: z.object({ name: z.string() }),
			handler: async () => ({ id: "1" }),
		});
		expect(def.body).toBeDefined();
	});

	it("allows PUT with body schema", () => {
		const def = api({
			method: "PUT",
			path: "/users/:id",
			body: z.object({ name: z.string() }),
			handler: async () => ({ ok: true }),
		});
		expect(def.body).toBeDefined();
	});

	it("allows PATCH with body schema", () => {
		const def = api({
			method: "PATCH",
			path: "/users/:id",
			body: z.object({ name: z.string().optional() }),
			handler: async () => ({ ok: true }),
		});
		expect(def.body).toBeDefined();
	});

	it("allows DELETE without body schema", () => {
		const def = api({
			method: "DELETE",
			path: "/users/:id",
			handler: async () => ({ ok: true }),
		});
		expect(def.method).toBe("DELETE");
	});
});

describe("isApiDefinition()", () => {
	it("returns true for an API definition", () => {
		const def = api({
			method: "GET",
			path: "/users",
			handler: async () => [],
		});
		expect(isApiDefinition(def)).toBe(true);
	});

	it("returns false for a plain object", () => {
		expect(isApiDefinition({ method: "GET", path: "/users" })).toBe(false);
	});

	it("returns false for null", () => {
		expect(isApiDefinition(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isApiDefinition(undefined)).toBe(false);
	});

	it("returns false for a string", () => {
		expect(isApiDefinition("hello")).toBe(false);
	});

	it("returns false for a branded but wrong brand", () => {
		expect(isApiDefinition({ __brand: "Other" })).toBe(false);
	});
});
