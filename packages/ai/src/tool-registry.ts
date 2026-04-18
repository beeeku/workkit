import type { ToolCall, ToolDefinition } from "./tools";

/** A tool handler pairs a definition with an execution function */
export interface ToolHandler {
	/** The tool definition to expose to the model */
	definition: ToolDefinition;
	/** Function that executes the tool and returns a string result */
	handler: (args: Record<string, unknown>) => Promise<string>;
}

/** A registry that maps tool names to handlers */
export interface ToolRegistry {
	/** Register a tool handler under a given name */
	register(name: string, tool: ToolHandler): void;
	/** Get all registered tool definitions */
	getTools(): ToolDefinition[];
	/** Execute a tool call using the registered handler */
	execute(call: ToolCall): Promise<string>;
}

/**
 * Create a tool registry for managing and executing tool handlers.
 *
 * Use with `aiWithTools` to automatically dispatch tool calls:
 *
 * @example
 * ```ts
 * const registry = createToolRegistry();
 * registry.register('search', {
 *   definition: {
 *     name: 'search',
 *     description: 'Search the web',
 *     parameters: {
 *       type: 'object',
 *       properties: { query: { type: 'string' } },
 *       required: ['query'],
 *     },
 *   },
 *   handler: async (args) => {
 *     const results = await search(args.query as string);
 *     return JSON.stringify(results);
 *   },
 * });
 *
 * const result = await aiWithTools(
 *   env.AI,
 *   model,
 *   { messages },
 *   { tools: registry.getTools() },
 *   (call) => registry.execute(call),
 * );
 * ```
 *
 * @deprecated Use `createToolRegistry` from `@workkit/ai-gateway` (ported in
 * #76 — same shape, typed against `GatewayToolDefinition` / `GatewayToolCall`).
 * See ADR-001; tracked in #63.
 */
export function createToolRegistry(): ToolRegistry {
	const handlers = new Map<string, ToolHandler>();

	return {
		register(name: string, tool: ToolHandler): void {
			handlers.set(name, tool);
		},

		getTools(): ToolDefinition[] {
			return Array.from(handlers.values()).map((h) => h.definition);
		},

		async execute(call: ToolCall): Promise<string> {
			const tool = handlers.get(call.name);
			if (!tool) {
				throw new Error(`Unknown tool: "${call.name}"`);
			}
			return tool.handler(call.arguments);
		},
	};
}
