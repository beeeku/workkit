import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMCPServer } from "../src/server";

describe("Integration: Full MCP Server", () => {
	function createTestServer() {
		return createMCPServer({
			name: "test-tools",
			version: "1.0.0",
			description: "Integration test server",
		})
			.tool("search", {
				description: "Search documents",
				input: z.object({
					query: z.string().min(1),
					limit: z.number().int().min(1).max(100).default(10),
				}),
				output: z.object({
					results: z.array(z.object({ title: z.string(), score: z.number() })),
					total: z.number(),
				}),
				tags: ["search"],
				annotations: { readOnlyHint: true },
				handler: async ({ input }) => ({
					results: [{ title: `Result for "${input.query}"`, score: 0.95 }],
					total: 1,
				}),
			})
			.resource("config://settings", {
				description: "App settings",
				mimeType: "application/json",
				handler: async () => ({
					contents: [
						{ uri: "config://settings", mimeType: "application/json", text: '{"theme":"dark"}' },
					],
				}),
			})
			.prompt("summarize", {
				description: "Summarize content",
				args: z.object({ style: z.enum(["brief", "detailed"]).default("brief") }),
				handler: async ({ args }) => ({
					messages: [
						{
							role: "user" as const,
							content: { type: "text" as const, text: `Summarize in ${args.style} style` },
						},
					],
				}),
			})
			.serve();
	}

	const env = {};
	const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

	// ─── MCP Protocol Path ──────────────────────────────────────────

	it("MCP: initialize → tools/list → tools/call flow", async () => {
		const server = createTestServer();

		// Initialize
		const initRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "test", version: "1.0" },
					},
				}),
			}),
			env,
			ctx,
		);
		expect(initRes.status).toBe(200);
		const initBody = await initRes.json();
		expect(initBody.result.capabilities.tools).toBeDefined();

		// List tools
		const listRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
			}),
			env,
			ctx,
		);
		const listBody = await listRes.json();
		expect(listBody.result.tools).toHaveLength(1);
		expect(listBody.result.tools[0].name).toBe("search");
		expect(listBody.result.tools[0].inputSchema).toBeDefined();

		// Call tool
		const callRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "search", arguments: { query: "cloudflare workers" } },
				}),
			}),
			env,
			ctx,
		);
		const callBody = await callRes.json();
		expect(callBody.result.isError).toBeUndefined();
		const toolResult = JSON.parse(callBody.result.content[0].text);
		expect(toolResult.results[0].title).toContain("cloudflare workers");
	});

	it("MCP: resources/list → resources/read", async () => {
		const server = createTestServer();

		const listRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/list" }),
			}),
			env,
			ctx,
		);
		const listBody = await listRes.json();
		expect(listBody.result.resources).toHaveLength(1);

		const readRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "resources/read",
					params: { uri: "config://settings" },
				}),
			}),
			env,
			ctx,
		);
		const readBody = await readRes.json();
		expect(readBody.result.contents[0].text).toBe('{"theme":"dark"}');
	});

	it("MCP: prompts/list → prompts/get", async () => {
		const server = createTestServer();

		const listRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list" }),
			}),
			env,
			ctx,
		);
		const listBody = await listRes.json();
		expect(listBody.result.prompts).toHaveLength(1);

		const getRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "prompts/get",
					params: { name: "summarize", arguments: { style: "detailed" } },
				}),
			}),
			env,
			ctx,
		);
		const getBody = await getRes.json();
		expect(getBody.result.messages[0].content.text).toContain("detailed");
	});

	// ─── REST Path ──────────────────────────────────────────────────

	it("REST: POST /api/tools/search returns result", async () => {
		const server = createTestServer();

		const res = await server.fetch(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "test" }),
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.result.results).toHaveLength(1);
		expect(body.result.total).toBe(1);
	});

	it("REST: POST /api/tools/search with invalid input returns 400", async () => {
		const server = createTestServer();

		const res = await server.fetch(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "" }),
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(400);
	});

	// ─── Meta Endpoints ─────────────────────────────────────────────

	it("GET /openapi.json returns spec", async () => {
		const server = createTestServer();

		const res = await server.fetch(new Request("http://localhost/openapi.json"), env, ctx);

		expect(res.status).toBe(200);
		const spec = await res.json();
		expect(spec.openapi).toBe("3.1.0");
		expect(spec.paths["/api/tools/search"]).toBeDefined();
	});

	it("GET /health returns ok", async () => {
		const server = createTestServer();

		const res = await server.fetch(new Request("http://localhost/health"), env, ctx);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	// ─── Same Handler, Two Paths ────────────────────────────────────

	it("MCP and REST paths return consistent results", async () => {
		const server = createTestServer();

		// MCP path
		const mcpRes = await server.fetch(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "search", arguments: { query: "consistency" } },
				}),
			}),
			env,
			ctx,
		);
		const mcpBody = await mcpRes.json();
		const mcpResult = JSON.parse(mcpBody.result.content[0].text);

		// REST path
		const restRes = await server.fetch(
			new Request("http://localhost/api/tools/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "consistency" }),
			}),
			env,
			ctx,
		);
		const restBody = await restRes.json();

		// Same handler, same result
		expect(mcpResult).toEqual(restBody.result);
	});
});
