import { BindingNotFoundError } from "@workkit/errors";
import type { ToolCall, ToolUseOptions, ToolUseResult } from "./tools";
import type { AiBinding } from "./types";

/** Message format for tool use conversations */
export interface ToolMessage {
	role: string;
	content: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

const DEFAULT_MAX_TURNS = 5;

/**
 * Parse tool calls from the raw Workers AI response.
 *
 * Workers AI returns tool calls in the format:
 * ```
 * { tool_calls: [{ id, type: "function", function: { name, arguments: "json" } }] }
 * ```
 */
function parseToolCalls(response: unknown): ToolCall[] {
	if (response == null || typeof response !== "object") return [];

	const obj = response as Record<string, unknown>;
	const rawCalls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(rawCalls) || rawCalls.length === 0) return [];

	const parsed: ToolCall[] = [];
	for (const raw of rawCalls) {
		const fn = raw.function as Record<string, unknown> | undefined;
		if (!fn || typeof fn.name !== "string") continue;

		let args: Record<string, unknown> = {};
		if (typeof fn.arguments === "string") {
			try {
				args = JSON.parse(fn.arguments) as Record<string, unknown>;
			} catch {
				args = {};
			}
		} else if (fn.arguments != null && typeof fn.arguments === "object") {
			args = fn.arguments as Record<string, unknown>;
		}

		parsed.push({
			id: typeof raw.id === "string" ? raw.id : `call_${parsed.length}`,
			name: fn.name,
			arguments: args,
		});
	}

	return parsed;
}

/** Extract text content from a Workers AI response */
function extractContent(response: unknown): string {
	if (response == null) return "";
	if (typeof response === "string") return response;
	if (typeof response === "object") {
		const obj = response as Record<string, unknown>;
		if (typeof obj.response === "string") return obj.response;
		if (typeof obj.content === "string") return obj.content;
	}
	return "";
}

/** Convert ToolDefinition[] to Workers AI tool format */
function toWorkersAiTools(tools: ToolUseOptions["tools"]): Array<{
	type: "function";
	function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

/**
 * Run an AI model with tool use support.
 *
 * Sends messages and tool definitions to the model. If the model returns tool calls
 * and a handler is provided, the handler is invoked for each tool call and the results
 * are fed back to the model in a loop (up to `maxTurns`).
 *
 * If no handler is provided, the first set of tool calls is returned immediately
 * for the caller to handle.
 *
 * @param binding - The AI binding from the worker environment (env.AI)
 * @param model - The model identifier
 * @param input - Messages for the conversation
 * @param options - Tool definitions and configuration
 * @param handler - Optional function to execute tool calls automatically
 * @returns The final result with content, tool calls, and metadata
 * @throws {BindingNotFoundError} If the binding is nullish
 *
 * @example
 * ```ts
 * // With automatic tool execution
 * const result = await aiWithTools(
 *   env.AI,
 *   '@cf/meta/llama-3.1-70b-instruct',
 *   { messages: [{ role: 'user', content: 'What is the weather?' }] },
 *   { tools: [weatherTool] },
 *   async (call) => JSON.stringify({ temp: 72 }),
 * )
 *
 * // Without handler — returns tool calls for manual execution
 * const result = await aiWithTools(
 *   env.AI,
 *   '@cf/meta/llama-3.1-70b-instruct',
 *   { messages: [{ role: 'user', content: 'What is the weather?' }] },
 *   { tools: [weatherTool] },
 * )
 * // result.toolCalls contains the model's requested calls
 * ```
 *
 * @deprecated Use `gateway.run(model, input, { toolOptions: { tools, toolChoice } })`
 * from `@workkit/ai-gateway` — unified tool-call normalization across Workers AI,
 * OpenAI, and Anthropic. See ADR-001; tracked in #63.
 */
export async function aiWithTools(
	binding: AiBinding,
	model: string,
	input: { messages: ToolMessage[] },
	options: ToolUseOptions,
	handler?: (call: ToolCall) => Promise<string>,
): Promise<ToolUseResult> {
	if (!binding) {
		throw new BindingNotFoundError("AI");
	}

	const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
	const workersTools = toWorkersAiTools(options.tools);
	const allToolCalls: ToolCall[] = [];
	const messages = [...input.messages];
	let turns = 0;

	for (let turn = 0; turn < maxTurns; turn++) {
		turns++;

		const aiInput: Record<string, unknown> = {
			messages,
			tools: workersTools,
		};

		if (options.toolChoice !== undefined) {
			aiInput.tool_choice = options.toolChoice;
		}

		const response = await binding.run(model, aiInput);
		const toolCalls = parseToolCalls(response);

		if (toolCalls.length === 0) {
			// Model returned text without tool calls — we're done
			return {
				content: extractContent(response),
				toolCalls: allToolCalls,
				model,
				turns,
			};
		}

		allToolCalls.push(...toolCalls);

		// If no handler, return immediately with the tool calls
		if (!handler) {
			return {
				content: extractContent(response),
				toolCalls: allToolCalls,
				model,
				turns,
			};
		}

		// Append assistant message with tool calls
		messages.push({
			role: "assistant",
			content: extractContent(response),
			tool_calls: toolCalls,
		});

		// Execute each tool call and append results
		for (const call of toolCalls) {
			const result = await handler(call);
			messages.push({
				role: "tool",
				content: result,
				tool_call_id: call.id,
			});
		}
	}

	// Hit maxTurns — return what we have
	return {
		content: "",
		toolCalls: allToolCalls,
		model,
		turns,
	};
}
