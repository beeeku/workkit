// tests/registry.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPromptRegistry, createResourceRegistry, createToolRegistry } from "../src/registry";

describe("ToolRegistry", () => {
	it("registers a tool and retrieves it", () => {
		const registry = createToolRegistry();
		registry.register("search", {
			description: "Search docs",
			input: z.object({ query: z.string() }),
			handler: async ({ input }) => ({ results: [] }),
		});

		expect(registry.get("search")).toBeDefined();
		expect(registry.get("search")!.name).toBe("search");
		expect(registry.get("search")!.description).toBe("Search docs");
		expect(registry.size).toBe(1);
	});

	it("throws on duplicate tool name", () => {
		const registry = createToolRegistry();
		registry.register("search", {
			description: "Search",
			input: z.object({ query: z.string() }),
			handler: async () => ({}),
		});

		expect(() =>
			registry.register("search", {
				description: "Search again",
				input: z.object({ query: z.string() }),
				handler: async () => ({}),
			}),
		).toThrow('Tool "search" already registered');
	});

	it("applies default values for optional fields", () => {
		const registry = createToolRegistry();
		registry.register("test", {
			description: "Test",
			input: z.object({}),
			handler: async () => ({}),
		});

		const tool = registry.get("test")!;
		expect(tool.tags).toEqual([]);
		expect(tool.annotations).toEqual({});
		expect(tool.middleware).toEqual([]);
		expect(tool.timeout).toBe(25000);
		expect(tool.progress).toBe(false);
		expect(tool.cancellable).toBe(false);
	});

	it("lists all registered tools", () => {
		const registry = createToolRegistry();
		registry.register("a", { description: "A", input: z.object({}), handler: async () => ({}) });
		registry.register("b", { description: "B", input: z.object({}), handler: async () => ({}) });

		const all = registry.all();
		expect(all).toHaveLength(2);
		expect(all.map((t) => t.name)).toEqual(["a", "b"]);
	});

	it("freeze prevents further registration", () => {
		const registry = createToolRegistry();
		registry.register("a", { description: "A", input: z.object({}), handler: async () => ({}) });
		registry.freeze();

		expect(() =>
			registry.register("b", { description: "B", input: z.object({}), handler: async () => ({}) }),
		).toThrow("Registry is frozen");
	});
});

describe("ResourceRegistry", () => {
	it("registers a static resource", () => {
		const registry = createResourceRegistry();
		registry.register("config://app/settings", {
			description: "App settings",
			mimeType: "application/json",
			handler: async () => ({ contents: [{ uri: "config://app/settings", text: "{}" }] }),
		});

		expect(registry.get("config://app/settings")).toBeDefined();
		expect(registry.get("config://app/settings")!.isTemplate).toBe(false);
	});

	it("detects URI templates", () => {
		const registry = createResourceRegistry();
		registry.register("file://docs/{path}", {
			handler: async () => ({ contents: [] }),
		});

		const resource = registry.get("file://docs/{path}")!;
		expect(resource.isTemplate).toBe(true);
	});

	it("matches URI against templates", () => {
		const registry = createResourceRegistry();
		registry.register("db://users/{id}", {
			handler: async () => ({ contents: [] }),
		});

		const match = registry.match("db://users/abc-123");
		expect(match).toBeDefined();
		expect(match!.params).toEqual({ id: "abc-123" });
	});

	it("matches exact URIs before templates", () => {
		const registry = createResourceRegistry();
		registry.register("db://users/admin", {
			description: "Admin user",
			handler: async () => ({ contents: [{ uri: "db://users/admin", text: "admin" }] }),
		});
		registry.register("db://users/{id}", {
			handler: async () => ({ contents: [] }),
		});

		const match = registry.match("db://users/admin");
		expect(match!.resource.description).toBe("Admin user");
	});
});

describe("PromptRegistry", () => {
	it("registers and retrieves a prompt", () => {
		const registry = createPromptRegistry();
		registry.register("summarize", {
			description: "Summarize a doc",
			args: z.object({ docId: z.string() }),
			handler: async ({ args }) => ({
				messages: [
					{
						role: "user" as const,
						content: { type: "text" as const, text: `Summarize ${args.docId}` },
					},
				],
			}),
		});

		expect(registry.get("summarize")).toBeDefined();
		expect(registry.get("summarize")!.description).toBe("Summarize a doc");
	});

	it("throws on duplicate prompt name", () => {
		const registry = createPromptRegistry();
		registry.register("test", {
			handler: async () => ({ messages: [] }),
		});
		expect(() => registry.register("test", { handler: async () => ({ messages: [] }) })).toThrow(
			'Prompt "test" already registered',
		);
	});
});
