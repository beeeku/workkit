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
			parameters: [{ name: "x-tenant", in: "header", required: false, schema: { type: "string" } }],
			get: {
				summary: "List users",
				tags: ["users"],
				parameters: [{ name: "limit", in: "query", required: false, schema: { type: "number" } }],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: { type: "object", properties: { id: { type: "string" } } },
								},
							},
						},
					},
				},
			},
			post: {
				summary: "Create user",
				tags: ["users"],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { type: "object", properties: { name: { type: "string" } } },
						},
					},
				},
				responses: {
					"200": {
						description: "Created",
						content: {
							"application/json": {
								schema: { type: "object", properties: { id: { type: "string" } } },
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
				// Explicitly disable auth for this operation (overrides root security)
				security: [],
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
		expect(output).toContain("- POST /users — Create user");
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
		expect(output).toContain("### POST /users");
		expect(output).toContain(
			'- application/json: {"type":"object","properties":{"name":{"type":"string"}}}',
		);
		expect(output).toContain("Responses:");
		expect(output).toContain('"type":"object"');
	});

	it("treats operation security: [] as none, overriding root security", () => {
		const output = generateLlmsFullTxt(openapiRecord, { groupBy: "none" });

		// DELETE /users/{id} has security: [] — should be "none", not inherited "bearerAuth"
		const deleteSection = output.slice(output.indexOf("### DELETE /users/{id}"));
		const authLine = deleteSection.split("\n").find((l) => l.startsWith("Auth:"));
		expect(authLine).toBe("Auth: none");

		// GET /users has no operation-level security — should inherit root bearerAuth
		const getUsersSection = output.slice(output.indexOf("### GET /users\n"));
		const getUsersAuth = getUsersSection.split("\n").find((l) => l.startsWith("Auth:"));
		expect(getUsersAuth).toBe("Auth: bearerAuth");
	});

	it("includes path-item-level parameters in operation output", () => {
		const output = generateLlmsFullTxt(openapiRecord, { groupBy: "none" });

		// GET /users has a path-item-level parameter x-tenant plus its own limit param
		const getUsersSection = output.slice(output.indexOf("### GET /users\n"));
		expect(getUsersSection).toContain("header.x-tenant");
		expect(getUsersSection).toContain("query.limit");
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
