import { describe, expect, it, vi } from "vitest";
import { aiWithTools } from "../src/tool-use";
import type { AiBinding } from "../src/types";

/** Helper: create a mock AI binding that returns configured responses in sequence */
function createMockBinding(
	...responses: unknown[]
): AiBinding & { calls: Array<{ model: string; inputs: Record<string, unknown> }> } {
	const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
	let callIndex = 0;
	return {
		calls,
		async run(model: string, inputs: Record<string, unknown>) {
			calls.push({ model, inputs });
			const response = responses[callIndex] ?? responses[responses.length - 1];
			callIndex++;
			return response;
		},
	};
}

const searchTool = {
	name: "search",
	description: "Search the web",
	parameters: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
	},
};

const calcTool = {
	name: "calculator",
	description: "Perform math",
	parameters: {
		type: "object",
		properties: { expression: { type: "string" } },
		required: ["expression"],
	},
};

describe("aiWithTools()", () => {
	it("throws BindingNotFoundError when binding is null", async () => {
		await expect(
			aiWithTools(
				null as unknown as AiBinding,
				"model",
				{ messages: [{ role: "user", content: "hi" }] },
				{ tools: [searchTool] },
			),
		).rejects.toThrow("AI");
	});

	describe("single tool call", () => {
		it("calls handler and returns final text after one tool round", async () => {
			const binding = createMockBinding(
				// First response: model requests a tool call
				{
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: {
								name: "search",
								arguments: JSON.stringify({ query: "weather" }),
							},
						},
					],
				},
				// Second response: model returns final text
				{ response: "The weather is sunny." },
			);

			const handler = vi.fn().mockResolvedValue("72°F and sunny");

			const result = await aiWithTools(
				binding,
				"@cf/meta/llama-3.1-70b-instruct",
				{ messages: [{ role: "user", content: "What is the weather?" }] },
				{ tools: [searchTool] },
				handler,
			);

			expect(result.content).toBe("The weather is sunny.");
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls[0].name).toBe("search");
			expect(result.toolCalls[0].arguments).toEqual({ query: "weather" });
			expect(result.model).toBe("@cf/meta/llama-3.1-70b-instruct");
			expect(result.turns).toBe(2);

			// Handler was called with the parsed tool call
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({
				id: "call_1",
				name: "search",
				arguments: { query: "weather" },
			});

			// Second AI call should include tool result messages
			expect(binding.calls).toHaveLength(2);
			const secondCallMessages = binding.calls[1].inputs.messages as Array<{
				role: string;
				content: string;
				tool_call_id?: string;
			}>;
			// Should have original user message + assistant + tool result
			expect(secondCallMessages).toHaveLength(3);
			expect(secondCallMessages[2].role).toBe("tool");
			expect(secondCallMessages[2].content).toBe("72°F and sunny");
			expect(secondCallMessages[2].tool_call_id).toBe("call_1");
		});
	});

	describe("parallel tool calls", () => {
		it("handles multiple tool calls in one response", async () => {
			const binding = createMockBinding(
				// First response: two tool calls
				{
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: {
								name: "search",
								arguments: JSON.stringify({ query: "weather" }),
							},
						},
						{
							id: "call_2",
							type: "function",
							function: {
								name: "calculator",
								arguments: JSON.stringify({ expression: "72 + 5" }),
							},
						},
					],
				},
				// Second response: final text
				{ response: "Done with both." },
			);

			const handler = vi.fn().mockImplementation(async (call) => {
				if (call.name === "search") return "sunny";
				if (call.name === "calculator") return "77";
				return "unknown";
			});

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool, calcTool] },
				handler,
			);

			expect(result.content).toBe("Done with both.");
			expect(result.toolCalls).toHaveLength(2);
			expect(handler).toHaveBeenCalledTimes(2);
			expect(result.turns).toBe(2);
		});
	});

	describe("no tool calls", () => {
		it("returns text directly when model does not call tools", async () => {
			const binding = createMockBinding({ response: "Hello, how can I help?" });

			const handler = vi.fn();

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "Hi" }] },
				{ tools: [searchTool] },
				handler,
			);

			expect(result.content).toBe("Hello, how can I help?");
			expect(result.toolCalls).toHaveLength(0);
			expect(result.turns).toBe(1);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("maxTurns limit", () => {
		it("stops after maxTurns rounds even if model keeps calling tools", async () => {
			const toolCallResponse = {
				tool_calls: [
					{
						id: "call_loop",
						type: "function",
						function: {
							name: "search",
							arguments: JSON.stringify({ query: "infinite" }),
						},
					},
				],
			};

			// Always returns tool calls, never plain text
			const binding = createMockBinding(
				toolCallResponse,
				toolCallResponse,
				toolCallResponse,
				toolCallResponse,
				toolCallResponse,
			);

			const handler = vi.fn().mockResolvedValue("result");

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "loop" }] },
				{ tools: [searchTool], maxTurns: 2 },
				handler,
			);

			expect(result.turns).toBe(2);
			expect(result.toolCalls).toHaveLength(2);
			expect(binding.calls).toHaveLength(2);
		});
	});

	describe("no handler", () => {
		it("returns tool calls for caller to handle when no handler provided", async () => {
			const binding = createMockBinding({
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: {
							name: "search",
							arguments: JSON.stringify({ query: "test" }),
						},
					},
				],
			});

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "search for test" }] },
				{ tools: [searchTool] },
			);

			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls[0].name).toBe("search");
			expect(result.toolCalls[0].arguments).toEqual({ query: "test" });
			expect(result.turns).toBe(1);
			// Should only make one AI call (no loop without handler)
			expect(binding.calls).toHaveLength(1);
		});
	});

	describe("invalid tool response handling", () => {
		it("handles tool call with unparseable arguments gracefully", async () => {
			const binding = createMockBinding({
				tool_calls: [
					{
						id: "call_bad",
						type: "function",
						function: {
							name: "search",
							arguments: "not valid json {{{",
						},
					},
				],
			});

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool] },
			);

			// Should still return the tool call, with empty arguments
			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls[0].arguments).toEqual({});
		});

		it("handles tool call with missing function name gracefully", async () => {
			const binding = createMockBinding({
				tool_calls: [
					{
						id: "call_no_name",
						type: "function",
						function: { arguments: "{}" },
					},
				],
			});

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool] },
			);

			// The malformed tool call is skipped — treated as no tool calls
			expect(result.toolCalls).toHaveLength(0);
			expect(result.content).toBe("");
		});

		it("generates id when tool call has no id", async () => {
			const binding = createMockBinding({
				tool_calls: [
					{
						type: "function",
						function: {
							name: "search",
							arguments: JSON.stringify({ query: "test" }),
						},
					},
				],
			});

			const result = await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool] },
			);

			expect(result.toolCalls).toHaveLength(1);
			expect(result.toolCalls[0].id).toBe("call_0");
		});
	});

	describe("tools format", () => {
		it("passes tools in Workers AI format to the binding", async () => {
			const binding = createMockBinding({ response: "ok" });

			await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool] },
			);

			const inputs = binding.calls[0].inputs;
			expect(inputs.tools).toEqual([
				{
					type: "function",
					function: {
						name: "search",
						description: "Search the web",
						parameters: {
							type: "object",
							properties: { query: { type: "string" } },
							required: ["query"],
						},
					},
				},
			]);
		});

		it("passes toolChoice when specified", async () => {
			const binding = createMockBinding({ response: "ok" });

			await aiWithTools(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ tools: [searchTool], toolChoice: "required" },
			);

			expect(binding.calls[0].inputs.tool_choice).toBe("required");
		});
	});
});
