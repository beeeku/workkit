import { describe, expect, it } from "vitest";
import { createLlmsRoutes, generateLlmsFullTxt, generateLlmsTxt } from "../src/llms";
import { createRouter } from "../src/router";

const openapiSpec = {
	openapi: "3.1.0",
	info: {
		title: "Workkit Demo API",
		description: "Demo API for llms generation",
	},
	security: [{ bearerAuth: [] }],
	paths: {
		"/users": {
			get: {
				summary: "List users",
				tags: ["users"],
				parameters: [{ name: "limit", in: "query", required: false, schema: { type: "number" } }],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
							},
						},
					},
				},
			},
		},
		"/users/{id}": {
			get: {
				summary: "Get user",
				tags: ["users"],
				security: [{ apiKeyAuth: [] }],
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: { type: "object", properties: { id: { type: "string" } } },
							},
						},
					},
				},
			},
			delete: {
				summary: "Delete user",
				tags: ["admin"],
				responses: { "204": { description: "Deleted" } },
			},
		},
		"/internal/health": {
			get: {
				summary: "Health check",
				responses: { "200": { description: "OK" } },
			},
		},
	},
} as const;
const openapiRecord = openapiSpec as unknown as Record<string, unknown>;

describe("llms generation", () => {
	it("generates llms.txt grouped by tags", () => {
		const output = generateLlmsTxt(openapiRecord, {
			siteBlurb: "Use this index to discover endpoints quickly.",
			groupBy: "tag",
		});

		expect(output).toContain("# Workkit Demo API");
		expect(output).toContain("### users");
		expect(output).toContain("### admin");
		expect(output).toContain("- GET /users — List users");
		expect(output).toContain("- DELETE /users/{id} — Delete user");
	});

	it("supports include and exclude path globs", () => {
		const output = generateLlmsTxt(openapiRecord, {
			includePaths: ["/users/**"],
			excludePaths: ["/users/{id}"],
		});

		expect(output).toContain("- GET /users — List users");
		expect(output).not.toContain("/users/{id}");
		expect(output).not.toContain("/internal/health");
	});

	it("generates llms-full.txt with schemas and auth details", () => {
		const output = generateLlmsFullTxt(openapiRecord, {
			groupBy: "resource",
		});

		expect(output).toContain("### GET /users/{id}");
		expect(output).toContain("Auth: apiKeyAuth");
		expect(output).toContain("Parameters:");
		expect(output).toContain("Request Body:");
		expect(output).toContain("Responses:");
		expect(output).toContain("\"type\":\"object\"");
	});
});

describe("createLlmsRoutes", () => {
	it("serves llms.txt and llms-full.txt routes", async () => {
		const [llms, llmsFull] = createLlmsRoutes({
			openapiSpec: () => openapiRecord,
		});

		const router = createRouter({ apis: [llms, llmsFull] });

		const llmsResponse = await router.fetch(new Request("http://localhost/llms.txt"), {});
		expect(llmsResponse.status).toBe(200);
		expect(llmsResponse.headers.get("Content-Type")).toContain("text/plain");
		expect(await llmsResponse.text()).toContain("- GET /users — List users");

		const llmsFullResponse = await router.fetch(new Request("http://localhost/llms-full.txt"), {});
		expect(llmsFullResponse.status).toBe(200);
		expect(await llmsFullResponse.text()).toContain("### GET /users");
	});
});
