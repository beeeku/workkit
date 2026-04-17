import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../src/tool-registry";
import type { ToolHandler } from "../src/tool-registry";

const searchTool: ToolHandler = {
	definition: {
		name: "search",
		description: "Search the web",
		parameters: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	handler: vi.fn().mockResolvedValue("search results"),
};

const calcTool: ToolHandler = {
	definition: {
		name: "calculator",
		description: "Do math",
		parameters: {
			type: "object",
			properties: { expression: { type: "string" } },
			required: ["expression"],
		},
	},
	handler: vi.fn().mockResolvedValue("42"),
};

describe("createToolRegistry()", () => {
	describe("register and getTools", () => {
		it("returns empty array when no tools registered", () => {
			const registry = createToolRegistry();
			expect(registry.getTools()).toEqual([]);
		});

		it("returns all registered tool definitions", () => {
			const registry = createToolRegistry();
			registry.register("search", searchTool);
			registry.register("calculator", calcTool);

			const tools = registry.getTools();
			expect(tools).toHaveLength(2);
			expect(tools[0].name).toBe("search");
			expect(tools[1].name).toBe("calculator");
		});

		it("overwrites tool when registered with same name", () => {
			const registry = createToolRegistry();
			registry.register("search", searchTool);

			const updatedTool: ToolHandler = {
				definition: { ...searchTool.definition, description: "Updated search" },
				handler: searchTool.handler,
			};
			registry.register("search", updatedTool);

			const tools = registry.getTools();
			expect(tools).toHaveLength(1);
			expect(tools[0].description).toBe("Updated search");
		});
	});

	describe("execute", () => {
		it("executes registered tool with correct arguments", async () => {
			const handler = vi.fn().mockResolvedValue("result for weather");
			const registry = createToolRegistry();
			registry.register("search", {
				definition: searchTool.definition,
				handler,
			});

			const result = await registry.execute({
				id: "call_1",
				name: "search",
				arguments: { query: "weather" },
			});

			expect(result).toBe("result for weather");
			expect(handler).toHaveBeenCalledWith({ query: "weather" });
		});

		it("throws on unknown tool name", async () => {
			const registry = createToolRegistry();
			registry.register("search", searchTool);

			await expect(
				registry.execute({
					id: "call_1",
					name: "nonexistent",
					arguments: {},
				}),
			).rejects.toThrow('Unknown tool: "nonexistent"');
		});

		it("passes empty arguments correctly", async () => {
			const handler = vi.fn().mockResolvedValue("no args");
			const registry = createToolRegistry();
			registry.register("noargs", {
				definition: {
					name: "noargs",
					description: "Tool with no args",
					parameters: { type: "object", properties: {} },
				},
				handler,
			});

			await registry.execute({ id: "call_1", name: "noargs", arguments: {} });
			expect(handler).toHaveBeenCalledWith({});
		});

		it("propagates handler errors", async () => {
			const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
			const registry = createToolRegistry();
			registry.register("failing", {
				definition: {
					name: "failing",
					description: "A failing tool",
					parameters: { type: "object", properties: {} },
				},
				handler,
			});

			await expect(
				registry.execute({ id: "call_1", name: "failing", arguments: {} }),
			).rejects.toThrow("handler failed");
		});
	});
});
