import { ConfigError } from "@workkit/errors";
import type {
	ChatMessage,
	Gateway,
	GatewayToolCall,
	GatewayToolDefinition,
	RunOptions,
} from "./types";

const DEFAULT_MAX_TURNS = 5;

/**
 * Message format for tool-use conversations.
 *
 * Extends `ChatMessage` with optional `tool_calls` / `tool_call_id` fields
 * used during multi-turn tool execution.
 */
export interface ToolMessage extends Omit<ChatMessage, "role"> {
	role: "system" | "user" | "assistant" | "tool";
	tool_calls?: GatewayToolCall[];
	tool_call_id?: string;
}

/** Options for an `aiWithTools` session. */
export interface AiWithToolsOptions {
	/** Tool definitions to expose to the model. */
	tools: GatewayToolDefinition[];
	/** How the model should choose tools. */
	toolChoice?: "auto" | "none" | "required" | { name: string };
	/** Maximum number of model turns before stopping (default: 5). */
	maxTurns?: number;
	/**
	 * Tool-call handler. When provided, tool calls are dispatched automatically
	 * and results are fed back to the model for another turn. When absent, the
	 * first set of tool calls is returned for the caller to dispatch themselves.
	 */
	handler?: (call: GatewayToolCall) => Promise<string>;
	/** Per-call gateway options (abort signal, timeout, provider override, …). */
	runOptions?: RunOptions;
}

/** Result from a tool-use session. */
export interface AiWithToolsResult {
	/** Final text content from the model (or "" if we hit maxTurns). */
	content: string;
	/** Every tool call the model made across all turns. */
	toolCalls: GatewayToolCall[];
	/** Provider that produced the final response. */
	provider: string;
	/** Model used. */
	model: string;
	/** Number of model turns taken. */
	turns: number;
}

/**
 * Run a gateway model with tool use across one or more turns.
 *
 * If `options.handler` is supplied, each tool call the model emits is executed
 * and the result is fed back as a `role: "tool"` message for the next turn,
 * up to `maxTurns`. If `handler` is absent, the first set of tool calls is
 * returned to the caller immediately for manual dispatch.
 *
 * @example
 * ```ts
 * const registry = createToolRegistry();
 * registry.register("get_weather", { definition, handler: async args => … });
 *
 * const result = await aiWithTools(gateway, "claude-sonnet-4-6",
 *   { messages: [{ role: "user", content: "weather in SF?" }] },
 *   { tools: registry.getTools(), handler: (call) => registry.execute(call) },
 * );
 * ```
 */
export async function aiWithTools(
	gateway: Gateway,
	model: string,
	input: { messages: ToolMessage[] },
	options: AiWithToolsOptions,
): Promise<AiWithToolsResult> {
	if (!gateway) {
		throw new ConfigError("aiWithTools requires a gateway", {
			context: { gateway: String(gateway) },
		});
	}

	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	const allToolCalls: GatewayToolCall[] = [];
	const messages = [...input.messages];
	let turns = 0;
	let lastProvider = gateway.defaultProvider();
	let lastModel = model;

	for (let turn = 0; turn < maxTurns; turn++) {
		turns++;

		const output = await gateway.run(
			model,
			// The gateway's ChatMessage doesn't model `role: "tool"` natively — we
			// serialize tool-result messages as role:"user" below, but the
			// assistant messages with tool_calls stay as-is for the provider to
			// see its own prior turn.
			{ messages: toChatMessages(messages) },
			{
				...options.runOptions,
				toolOptions: {
					tools: options.tools,
					...(options.toolChoice !== undefined ? { toolChoice: options.toolChoice } : {}),
				},
			},
		);
		lastProvider = output.provider;
		lastModel = output.model;

		const toolCalls = output.toolCalls ?? [];
		const content = output.text ?? "";

		if (toolCalls.length === 0) {
			return { content, toolCalls: allToolCalls, provider: lastProvider, model: lastModel, turns };
		}

		allToolCalls.push(...toolCalls);

		if (!options.handler) {
			return { content, toolCalls: allToolCalls, provider: lastProvider, model: lastModel, turns };
		}

		// Record the assistant's tool-call turn for the next iteration's prompt.
		messages.push({ role: "assistant", content, tool_calls: toolCalls });

		for (const call of toolCalls) {
			const result = await options.handler(call);
			messages.push({ role: "tool", content: result, tool_call_id: call.id });
		}
	}

	return { content: "", toolCalls: allToolCalls, provider: lastProvider, model: lastModel, turns };
}

/** Flatten `ToolMessage[]` into gateway-compatible `ChatMessage[]`. */
function toChatMessages(messages: ToolMessage[]): ChatMessage[] {
	return messages.map((m) => {
		if (m.role === "tool") {
			// Serialize tool results as a user note tagged with the call id.
			return {
				role: "user",
				content: `[tool result id=${m.tool_call_id ?? ""}] ${m.content}`,
			};
		}
		return { role: m.role, content: m.content };
	});
}
