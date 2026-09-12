import { createToolRegistry as gatewayCreateToolRegistry } from "@workkit/ai-gateway";
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
 * @deprecated Re-exported from `@workkit/ai-gateway` — import from there going
 * forward. The gateway helper is structurally identical; the only migration
 * step is renaming the tool-type references: `ToolDefinition` →
 * `GatewayToolDefinition` and `ToolCall` → `GatewayToolCall` (see
 * `packages/ai/src/tools.ts` for the matching type-side deprecation notice).
 * Per [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md),
 * `@workkit/ai` will be removed at v2.0; track migration via
 * [#63](https://github.com/beeeku/workkit/issues/63).
 */
export function createToolRegistry(): ToolRegistry {
	// Delegates to `@workkit/ai-gateway`'s `createToolRegistry`. The gateway's
	// `GatewayToolDefinition` / `GatewayToolCall` are structurally identical
	// to this package's `ToolDefinition` / `ToolCall` (same three fields, same
	// types), so the returned object satisfies the ai-local `ToolRegistry`
	// interface without runtime bridging — the cast is a type identity, not
	// a shape conversion. First delegation slice of the ADR-001 shim (#63,
	// #105); the shared implementation source is `packages/ai-gateway/src/
	// tool-registry.ts`.
	return gatewayCreateToolRegistry() as unknown as ToolRegistry;
}
