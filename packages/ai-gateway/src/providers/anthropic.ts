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
		if (signal?.aborted) {
			throw new TimeoutError(`anthropic request for ${model}`, options?.timeout, {
				cause: err,
				context: { provider: providerName, model },
			});
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
		const systemMsg = msgs.find((m: ChatMessage) => m.role === "system");
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

		// Combine existing system message with JSON instruction. If the
		// caller's system message opts into cacheControl, emit the Anthropic
		// content-block array form so the cache_control flag is preserved.
		if (systemMsg?.cacheControl) {
			const blocks: Array<Record<string, unknown>> = [];
			if (jsonInstruction) {
				blocks.push({ type: "text", text: jsonInstruction });
			}
			blocks.push({
				type: "text",
				text: systemMsg.content,
				cache_control: { type: systemMsg.cacheControl },
			});
			body.system = blocks;
		} else {
			const systemParts: string[] = [];
			if (jsonInstruction) systemParts.push(jsonInstruction);
			if (systemMsg) systemParts.push(systemMsg.content);
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
	if (!content?.[0]) return undefined;
	return typeof content[0].text === "string" ? content[0].text : undefined;
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
