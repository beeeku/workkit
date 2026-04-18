import { ServiceUnavailableError, TimeoutError } from "@workkit/errors";
import type {
	AiInput,
	AiOutput,
	AnthropicProviderConfig,
	CfGatewayConfig,
	ChatMessage,
	GatewayToolCall,
	GatewayToolOptions,
	RunOptions,
	TokenUsage,
} from "../types";
import { cfGatewayHeaders, resolveBaseUrl } from "./shared";

export async function executeAnthropic(
	providerName: string,
	providerConfig: AnthropicProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<AiOutput> {
	const baseUrl = resolveBaseUrl(
		"anthropic",
		providerConfig.baseUrl,
		cfGateway,
		"https://api.anthropic.com/v1",
	);
	const body = buildAnthropicBody(model, input, options?.responseFormat, options?.toolOptions);
	const signal = options?.signal;

	try {
		const response = await fetch(`${baseUrl}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": providerConfig.apiKey,
				"anthropic-version": "2023-06-01",
				...cfGatewayHeaders(cfGateway),
			},
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "unknown error");
			throw new ServiceUnavailableError(`anthropic (${response.status})`, {
				context: { provider: providerName, model, status: response.status, body: errorBody },
			});
		}

		const raw = (await response.json()) as Record<string, unknown>;
		return {
			text: extractAnthropicText(raw),
			raw,
			usage: extractAnthropicUsage(raw),
			provider: providerName,
			model,
			toolCalls: extractAnthropicToolCalls(raw),
		};
	} catch (err) {
		if (err instanceof ServiceUnavailableError) throw err;
		// Only classify aborts as TimeoutError when the caller set a timeout;
		// external-signal cancels rethrow as-is so withRetry doesn't treat
		// user-aborts as retryable.
		if (signal?.aborted) {
			if (options?.timeout !== undefined) {
				throw new TimeoutError(`anthropic request for ${model}`, options.timeout, {
					cause: err,
					context: { provider: providerName, model },
				});
			}
			throw err;
		}
		throw new ServiceUnavailableError("anthropic", {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

export function buildAnthropicBody(
	model: string,
	input: AiInput,
	responseFormat?: "json" | { jsonSchema: Record<string, unknown> },
	toolOptions?: GatewayToolOptions,
): Record<string, unknown> {
	// Build the JSON instruction to prepend to the system message
	let jsonInstruction = "";
	if (responseFormat) {
		if (responseFormat === "json") {
			jsonInstruction = "You must respond with valid JSON only, no other text.";
		} else {
			jsonInstruction = [
				"You must respond with valid JSON only, no other text.",
				"Your response must conform to this JSON Schema:",
				JSON.stringify(responseFormat.jsonSchema),
			].join("\n");
		}
	}

	let body: Record<string, unknown>;

	if ("messages" in input && Array.isArray((input as { messages: unknown }).messages)) {
		const msgs = (input as { messages: ChatMessage[] }).messages;
		// Anthropic requires system messages to be separate
		const systemMsgs = msgs.filter((m: ChatMessage) => m.role === "system");
		const nonSystem = msgs.filter((m: ChatMessage) => m.role !== "system");
		body = {
			model,
			messages: nonSystem.map((m: ChatMessage) => ({
				role: m.role,
				content: m.cacheControl
					? [{ type: "text", text: m.content, cache_control: { type: m.cacheControl } }]
					: m.content,
			})),
			max_tokens: 1024,
		};

		// If any system message opts into cacheControl, emit the content-block
		// array form so the cache_control flag is preserved. Otherwise, join
		// system messages into a single string (Anthropic accepts either).
		const anyCached = systemMsgs.some((m) => m.cacheControl);
		if (anyCached) {
			const blocks: Array<Record<string, unknown>> = [];
			if (jsonInstruction) {
				blocks.push({ type: "text", text: jsonInstruction });
			}
			for (const sys of systemMsgs) {
				blocks.push({
					type: "text",
					text: sys.content,
					...(sys.cacheControl ? { cache_control: { type: sys.cacheControl } } : {}),
				});
			}
			body.system = blocks;
		} else {
			const systemParts: string[] = [];
			if (jsonInstruction) systemParts.push(jsonInstruction);
			for (const sys of systemMsgs) systemParts.push(sys.content);
			if (systemParts.length > 0) {
				body.system = systemParts.join("\n\n");
			}
		}
	} else if ("prompt" in input) {
		body = {
			model,
			messages: [{ role: "user", content: input.prompt }],
			max_tokens: 1024,
		};
		if (jsonInstruction) {
			body.system = jsonInstruction;
		}
	} else {
		body = { model, max_tokens: 1024, ...input };
		if (jsonInstruction) {
			body.system = jsonInstruction;
		}
	}

	if (toolOptions?.tools?.length) {
		// Anthropic uses `input_schema` instead of `parameters`
		body.tools = toolOptions.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.parameters,
		}));
		if (toolOptions.toolChoice !== undefined) {
			body.tool_choice = toolOptions.toolChoice;
		}
	}

	return body;
}

export function extractAnthropicText(raw: Record<string, unknown>): string | undefined {
	const content = raw.content as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(content)) return undefined;
	// Concatenate all text blocks — Anthropic can return multiple text blocks
	// interleaved with tool_use blocks in a single response.
	const text = content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("");
	return text.length > 0 ? text : undefined;
}

export function extractAnthropicUsage(raw: Record<string, unknown>): TokenUsage | undefined {
	const usage = raw.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	return {
		inputTokens: (usage.input_tokens as number) ?? 0,
		outputTokens: (usage.output_tokens as number) ?? 0,
	};
}

export function extractAnthropicToolCalls(
	raw: Record<string, unknown>,
): GatewayToolCall[] | undefined {
	const content = raw.content as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(content)) return undefined;

	const toolBlocks = content.filter((block) => block.type === "tool_use");
	if (toolBlocks.length === 0) return undefined;

	return toolBlocks.map((block) => ({
		id: typeof block.id === "string" ? block.id : `call_${Math.random().toString(36).slice(2)}`,
		name: block.name as string,
		arguments:
			block.input != null && typeof block.input === "object"
				? (block.input as Record<string, unknown>)
				: {},
	}));
}
