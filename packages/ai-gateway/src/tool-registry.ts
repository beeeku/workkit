import type { GatewayToolCall, GatewayToolDefinition } from "./types";

/** A tool handler pairs a definition with an execution function. */
export interface ToolHandler {
	/** The tool definition to expose to the model. */
	definition: GatewayToolDefinition;
	/** Function that executes the tool and returns a string result. */
	handler: (args: Record<string, unknown>) => Promise<string>;
}

/** A registry that maps tool names to handlers. */
export interface ToolRegistry {
	/** Register a tool handler under a given name. */
	register(name: string, tool: ToolHandler): void;
	/** Get all registered tool definitions. */
	getTools(): GatewayToolDefinition[];
	/** Execute a tool call using the registered handler. */
	execute(call: GatewayToolCall): Promise<string>;
}

/**
 * Create a tool registry for managing and executing tool handlers.
 *
 * Use with `aiWithTools` (or your own dispatch loop) to automatically route
 * the model's tool calls to registered handlers:
 *
 * @example
 * ```ts
 * const registry = createToolRegistry();
 * registry.register("search", {
 *   definition: {
 *     name: "search",
 *     description: "Search the web",
 *     parameters: {
 *       type: "object",
 *       properties: { query: { type: "string" } },
 *       required: ["query"],
 *     },
 *   },
 *   handler: async (args) => JSON.stringify(await search(args.query as string)),
 * });
 *
 * const result = await aiWithTools(gateway, model, input, {
 *   tools: registry.getTools(),
 *   handler: (call) => registry.execute(call),
 * });
 * ```
 */
export function createToolRegistry(): ToolRegistry {
	const handlers = new Map<string, ToolHandler>();

	return {
		register(name, tool) {
			handlers.set(name, tool);
		},
		getTools() {
			return Array.from(handlers.values()).map((h) => h.definition);
		},
		async execute(call) {
			const tool = handlers.get(call.name);
			if (!tool) throw new Error(`Unknown tool: "${call.name}"`);
			return tool.handler(call.arguments);
		},
	};
}
