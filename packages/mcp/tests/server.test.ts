// tests/server.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMCPServer } from "../src/server";

describe("createMCPServer", () => {
	it("creates a server with minimal config", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" });
		expect(server).toBeDefined();
		expect(server.tools.size).toBe(0);
	});

	it("registers tools via builder pattern", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" })
			.tool("a", {
				description: "Tool A",
				input: z.object({ x: z.string() }),
				handler: async () => ({}),
			})
			.tool("b", {
				description: "Tool B",
				input: z.object({ y: z.number() }),
				handler: async () => ({}),
			});

		expect(server.tools.size).toBe(2);
	});

	it("registers resources", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" }).resource(
			"config://settings",
			{
				handler: async () => ({ contents: [{ uri: "config://settings", text: "{}" }] }),
			},
		);

		expect(server.resources.size).toBe(1);
	});

	it("registers prompts", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" }).prompt("greet", {
			handler: async () => ({
				messages: [{ role: "user" as const, content: { type: "text" as const, text: "Hi" } }],
			}),
		});

		expect(server.prompts.size).toBe(1);
	});

	it("serve() returns a WorkerModule with fetch", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" }).tool("ping", {
			description: "Ping",
			input: z.object({}),
			handler: async () => ({ pong: true }),
		});

		const module = server.serve();
		expect(module.fetch).toBeDefined();
		expect(typeof module.fetch).toBe("function");
	});

	it("serve() freezes registries — no more registrations", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" });
		server.serve();

		expect(() =>
			server.tool("late", {
				description: "Late",
				input: z.object({}),
				handler: async () => ({}),
			}),
		).toThrow();
	});

	it("warns when no tools registered", () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg: string) => warnings.push(msg);

		const server = createMCPServer({ name: "test", version: "1.0.0" });
		server.serve();

		console.warn = originalWarn;
		expect(warnings.some((w) => w.includes("no tools"))).toBe(true);
	});

	it("mount() returns handler functions", () => {
		const server = createMCPServer({ name: "test", version: "1.0.0" }).tool("test", {
			description: "Test",
			input: z.object({}),
			handler: async () => ({}),
		});

		const mounted = server.mount();
		expect(mounted.mcpHandler).toBeDefined();
		expect(mounted.restHandler).toBeDefined();
		expect(mounted.openapi).toBeDefined();
	});
});
