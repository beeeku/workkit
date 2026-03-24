// tests/rest.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "../src/registry";
import { createRestHandler } from "../src/rest";

function setupRest(opts?: { basePath?: string; middleware?: any[] }) {
	const tools = createToolRegistry();

	tools.register("search", {
		description: "Search docs",
		input: z.object({ query: z.string(), limit: z.number().default(10) }),
		handler: async ({ input }) => ({
			results: [`found: ${input.query}`],
			total: 1,
		}),
	});

	tools.register("failing-tool", {
		description: "Always fails",
		input: z.object({}),
		handler: async () => {
			throw new Error("tool broke");
		},
	});

	tools.freeze();

	return createRestHandler({
		tools,
		basePath: opts?.basePath ?? "/api",
		middleware: opts?.middleware ?? [],
	});
}

describe("REST Handler", () => {
	const env = {};
	const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

	it("POST /api/tools/search returns 200 with result", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.result).toEqual({ results: ["found: test"], total: 1 });
	});

	it("applies default values from schema", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(200);
	});

	it("returns 400 for invalid input", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: 123 }),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error.code).toBe("VALIDATION_ERROR");
	});

	it("returns 404 for unknown tool", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/api/tools/nonexistent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(404);
	});

	it("returns 500 for handler errors", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/api/tools/failing-tool", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(500);
	});

	it("respects custom basePath", async () => {
		const rest = setupRest({ basePath: "/v1" });
		const response = await rest.handleRequest(
			new Request("http://localhost/v1/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			}),
			env,
			ctx,
		);

		expect(response.status).toBe(200);
	});

	it("runs server-level middleware", async () => {
		const called: string[] = [];
		const middleware = async (req: Request, env: any, next: () => any) => {
			called.push("middleware");
			return next();
		};

		const rest = setupRest({ middleware: [middleware] });
		await rest.handleRequest(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			}),
			env,
			ctx,
		);

		expect(called).toEqual(["middleware"]);
	});

	it("returns null for non-matching URLs", async () => {
		const rest = setupRest();
		const response = await rest.handleRequest(
			new Request("http://localhost/other/path", {
				method: "POST",
			}),
			env,
			ctx,
		);

		expect(response).toBeNull();
	});
});
