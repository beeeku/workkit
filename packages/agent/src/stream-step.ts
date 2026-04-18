import type { AiInput, AiOutput, GatewayStreamEvent, RunOptions } from "@workkit/ai-gateway";
import type { AgentEvent } from "./events";
import type { InternalAgentDef } from "./loop";

/**
 * Run a single model step against the provider, returning an `AiOutput`
 * while emitting per-token `text-delta` events via `emit`.
 *
 * When `provider.stream` is available, the underlying call is a streaming
 * SSE request and text arrives token-by-token. When it isn't, we fall back
 * to `provider.run` and emit a single synthesized `text-delta` with the
 * full text at the end of the step (preserves the non-streaming agent UX
 * as a graceful degradation).
 */
export async function runStep(
	currentAgent: InternalAgentDef,
	input: AiInput,
	runOptions: RunOptions,
	step: number,
	emit: (e: AgentEvent) => void,
): Promise<AiOutput> {
	if (!currentAgent.provider.stream) {
		// Non-streaming fallback: emit the whole text as one delta at the end.
		const output = await currentAgent.provider.run(currentAgent.model, input, runOptions);
		const text = output.text ?? "";
		if (text.length > 0) emit({ type: "text-delta", delta: text, step });
		return output;
	}

	const stream = await currentAgent.provider.stream(currentAgent.model, input, runOptions);
	const reader = stream.getReader();
	const toolCalls: NonNullable<AiOutput["toolCalls"]> = [];
	let text = "";
	let usage: AiOutput["usage"] | undefined;
	let raw: unknown;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const event: GatewayStreamEvent = value;
			if (event.type === "text") {
				text += event.delta;
				emit({ type: "text-delta", delta: event.delta, step });
			} else if (event.type === "tool_use") {
				toolCalls.push({ id: event.id, name: event.name, arguments: event.input });
			} else if (event.type === "done") {
				usage = event.usage;
				raw = event.raw;
			}
		}
	} finally {
		reader.releaseLock();
	}

	return {
		text: text.length > 0 ? text : undefined,
		raw,
		usage,
		provider: currentAgent.provider.defaultProvider(),
		model: currentAgent.model,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
}
