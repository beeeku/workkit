import type {
	AiInput,
	AiOutput,
	Gateway,
	GatewayStreamEvent,
	GatewayToolCall,
	RunOptions,
	TokenUsage,
} from "@workkit/ai-gateway";

export interface MockResponse {
	text?: string;
	toolCalls?: GatewayToolCall[];
	usage?: TokenUsage;
	delay?: number;
}

export interface MockGatewayState {
	calls: { model: string; input: AiInput; options?: RunOptions }[];
	responses: MockResponse[];
}

/**
 * Create a Gateway whose `run` returns a queued response per call. If the
 * queue runs out it returns an empty stop. Each call records its arguments
 * for assertion.
 */
export function mockGateway(responses: MockResponse[]): {
	gateway: Gateway;
	state: MockGatewayState;
} {
	const state: MockGatewayState = { calls: [], responses };
	const gateway: Gateway = {
		async run(model, input, options) {
			state.calls.push({ model, input, options });
			if (options?.signal?.aborted) {
				const reason = (options.signal as AbortSignal & { reason?: unknown }).reason;
				throw reason instanceof Error ? reason : new Error("aborted");
			}
			const next = state.responses.shift();
			if (!next) {
				return mkOutput(model, "");
			}
			if (next.delay) await new Promise<void>((resolve) => setTimeout(resolve, next.delay));
			if (options?.signal?.aborted) {
				const reason = (options.signal as AbortSignal & { reason?: unknown }).reason;
				throw reason instanceof Error ? reason : new Error("aborted");
			}
			return mkOutput(model, next.text ?? "", next.toolCalls, next.usage);
		},
		providers: () => ["mock"],
		defaultProvider: () => "mock",
	};
	return { gateway, state };
}

function mkOutput(
	model: string,
	text: string,
	toolCalls?: GatewayToolCall[],
	usage?: TokenUsage,
): AiOutput {
	return {
		text,
		raw: { model, text },
		usage: usage ?? { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		provider: "mock",
		model,
		toolCalls,
	};
}

export function call(
	name: string,
	args: Record<string, unknown> = {},
	id = `call_${name}`,
): GatewayToolCall {
	return { id, name, arguments: args };
}

/** A scripted step for the streaming mock: per-token text deltas + optional tool_use. */
export interface MockStreamStep {
	chunks?: string[];
	toolCalls?: GatewayToolCall[];
	usage?: TokenUsage;
}

/**
 * Mock gateway that implements `stream()`. Each `run()` call consumes one
 * step from `steps` and surfaces it as a `ReadableStream<GatewayStreamEvent>`
 * with per-chunk `text` events followed by `tool_use` events and a final `done`.
 */
export function mockStreamingGateway(steps: MockStreamStep[]): {
	gateway: Gateway;
	state: { streamCalls: number; runCalls: number };
} {
	const state = { streamCalls: 0, runCalls: 0 };
	const gateway: Gateway = {
		async run(model, _input, _options) {
			state.runCalls++;
			const step = steps.shift() ?? {};
			return {
				text: (step.chunks ?? []).join(""),
				raw: {},
				usage: step.usage,
				provider: "mock",
				model,
				toolCalls: step.toolCalls,
			};
		},
		async stream(_model, _input, _options) {
			state.streamCalls++;
			const step = steps.shift() ?? {};
			return new ReadableStream<GatewayStreamEvent>({
				start(controller) {
					for (const delta of step.chunks ?? []) {
						controller.enqueue({ type: "text", delta });
					}
					for (const tc of step.toolCalls ?? []) {
						controller.enqueue({
							type: "tool_use",
							id: tc.id,
							name: tc.name,
							input: tc.arguments,
						});
					}
					controller.enqueue({ type: "done", usage: step.usage });
					controller.close();
				},
			});
		},
		providers: () => ["mock"],
		defaultProvider: () => "mock",
	};
	return { gateway, state };
}
