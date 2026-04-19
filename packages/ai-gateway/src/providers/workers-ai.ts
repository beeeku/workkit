import { ServiceUnavailableError } from "@workkit/errors";
import type {
	AiInput,
	AiOutput,
	GatewayToolCall,
	GatewayToolOptions,
	RunOptions,
	WorkersAiProviderConfig,
} from "../types";
import { extractOpenAiStyleUsage, parseRawToolCalls } from "./shared";

export async function executeWorkersAi(
	providerName: string,
	providerConfig: WorkersAiProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
): Promise<AiOutput> {
	try {
		const aiInput = applyWorkersAiResponseFormat(input, options?.responseFormat);
		const finalInput = applyToolsWorkersAi(aiInput, options?.toolOptions);
		const raw = await providerConfig.binding.run(model, finalInput);
		return {
			text: typeof raw === "string" ? raw : extractWorkersAiText(raw),
			raw,
			usage: extractOpenAiStyleUsage(raw),
			provider: providerName,
			model,
			toolCalls: extractWorkersAiToolCalls(raw),
		};
	} catch (err) {
		throw new ServiceUnavailableError("workers-ai", {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

export function applyWorkersAiResponseFormat(
	input: AiInput,
	responseFormat?: "json" | { jsonSchema: Record<string, unknown> },
): AiInput {
	if (!responseFormat) return input;
	// Workers AI uses response_format: { type: "json_object" }
	return { ...input, response_format: { type: "json_object" } } as AiInput;
}

export function applyToolsWorkersAi(
	input: AiInput,
	toolOptions?: GatewayToolOptions,
): Record<string, unknown> {
	if (!toolOptions?.tools?.length) return input as Record<string, unknown>;

	const extended: Record<string, unknown> = { ...(input as Record<string, unknown>) };
	extended.tools = toolOptions.tools.map((t) => ({
		type: "function",
		function: { name: t.name, description: t.description, parameters: t.parameters },
	}));
	if (toolOptions.toolChoice !== undefined) {
		extended.tool_choice = toolOptions.toolChoice;
	}
	return extended;
}

function extractWorkersAiText(raw: unknown): string | undefined {
	if (raw == null) return undefined;
	if (typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		if (typeof obj.response === "string") return obj.response;
		if (typeof obj.text === "string") return obj.text;
	}
	return undefined;
}

function extractWorkersAiToolCalls(raw: unknown): GatewayToolCall[] | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const rawCalls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(rawCalls) || rawCalls.length === 0) return undefined;
	// Workers AI's `@cf/meta/llama-*` endpoint returns tool_calls in a flat
	// shape — `{name, arguments}` at the top level, no `function` nesting,
	// no `id`. Normalize to the OpenAI-compat wrapper so `parseRawToolCalls`
	// handles both paths (string/object arg normalization) without growing
	// provider-specific branches.
	const normalized = rawCalls.map((raw, idx) => normalizeWorkersAiToolCall(raw, idx));
	return parseRawToolCalls(normalized);
}

/**
 * Fallback-id prefix for Llama tool_calls that arrive without a provider id.
 * Kept deliberately distinct from OpenAI's `call_*` id namespace so a
 * response mixing id'd and un-id'd calls cannot produce duplicate ids
 * downstream (e.g. if the model emits `{id: "call_0"}` alongside a
 * later un-id'd entry — `parseRawToolCalls`'s generic `call_${i}` fallback
 * would collide).
 */
const WORKERS_AI_ANON_ID_PREFIX = "wkai_anon_";

function normalizeWorkersAiToolCall(
	raw: Record<string, unknown>,
	index: number,
): Record<string, unknown> {
	// Already OpenAI-compat (`{id, type, function: {...}}`) — pass through.
	if (raw.function && typeof raw.function === "object") return raw;
	// Llama-native flat shape — wrap `{name, arguments}` into the expected envelope.
	if (typeof raw.name === "string") {
		return {
			id: typeof raw.id === "string" ? raw.id : `${WORKERS_AI_ANON_ID_PREFIX}${index}`,
			type: "function",
			function: { name: raw.name, arguments: raw.arguments },
		};
	}
	return raw;
}

export { WORKERS_AI_ANON_ID_PREFIX };
