import { ServiceUnavailableError, TimeoutError } from "@workkit/errors";
import type {
	AiInput,
	AiOutput,
	CfGatewayConfig,
	ChatMessage,
	GatewayToolCall,
	GatewayToolOptions,
	OpenAiProviderConfig,
	RunOptions,
	TokenUsage,
} from "../types";
import { cfGatewayHeaders, parseRawToolCalls, resolveBaseUrl } from "./shared";

export async function executeOpenAi(
	providerName: string,
	providerConfig: OpenAiProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<AiOutput> {
	const baseUrl = resolveBaseUrl(
		"openai",
		providerConfig.baseUrl,
		cfGateway,
		"https://api.openai.com/v1",
	);
	const body = buildOpenAiBody(model, input, options?.responseFormat, options?.toolOptions);
	const signal = options?.signal;

	try {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${providerConfig.apiKey}`,
				...cfGatewayHeaders(cfGateway),
			},
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "unknown error");
			throw new ServiceUnavailableError(`openai (${response.status})`, {
				context: { provider: providerName, model, status: response.status, body: errorBody },
			});
		}

		const raw = (await response.json()) as Record<string, unknown>;
		return {
			text: extractOpenAiText(raw),
			raw,
			usage: extractOpenAiUsage(raw),
			provider: providerName,
			model,
			toolCalls: extractOpenAiToolCalls(raw),
		};
	} catch (err) {
		if (err instanceof ServiceUnavailableError) throw err;
		// Only classify aborts as TimeoutError when the caller set a timeout;
		// external-signal cancels rethrow as-is so withRetry doesn't treat
		// user-aborts as retryable.
		if (signal?.aborted) {
			if (options?.timeout !== undefined) {
				throw new TimeoutError(`openai request for ${model}`, options.timeout, {
					cause: err,
					context: { provider: providerName, model },
				});
			}
			throw err;
		}
		throw new ServiceUnavailableError("openai", {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

export function buildOpenAiBody(
	model: string,
	input: AiInput,
	responseFormat?: "json" | { jsonSchema: Record<string, unknown> },
	toolOptions?: GatewayToolOptions,
): Record<string, unknown> {
	let body: Record<string, unknown>;
	if ("messages" in input && Array.isArray((input as { messages: unknown }).messages)) {
		const msgs = (input as { messages: ChatMessage[] }).messages;
		// Strip provider-specific hints (e.g. cacheControl) — OpenAI rejects unknown fields.
		body = {
			model,
			messages: msgs.map(({ role, content }) => ({ role, content })),
		};
	} else if ("prompt" in input) {
		body = { model, messages: [{ role: "user", content: input.prompt }] };
	} else {
		body = { model, ...input };
	}

	if (responseFormat) {
		if (responseFormat === "json") {
			body.response_format = { type: "json_object" };
		} else {
			body.response_format = {
				type: "json_schema",
				json_schema: { name: "response", schema: responseFormat.jsonSchema, strict: true },
			};
		}
	}

	if (toolOptions?.tools?.length) {
		body.tools = toolOptions.tools.map((t) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.parameters },
		}));
		if (toolOptions.toolChoice !== undefined) {
			body.tool_choice = toolOptions.toolChoice;
		}
	}

	return body;
}

export function extractOpenAiText(raw: Record<string, unknown>): string | undefined {
	const choices = raw.choices as Array<Record<string, unknown>> | undefined;
	if (!choices?.[0]) return undefined;
	const message = choices[0].message as Record<string, unknown> | undefined;
	return typeof message?.content === "string" ? message.content : undefined;
}

export function extractOpenAiUsage(raw: Record<string, unknown>): TokenUsage | undefined {
	const usage = raw.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	return {
		inputTokens: (usage.prompt_tokens as number) ?? 0,
		outputTokens: (usage.completion_tokens as number) ?? 0,
	};
}

export function extractOpenAiToolCalls(
	raw: Record<string, unknown>,
): GatewayToolCall[] | undefined {
	const choices = raw.choices as Array<Record<string, unknown>> | undefined;
	if (!choices?.[0]) return undefined;
	const message = choices[0].message as Record<string, unknown> | undefined;
	if (!message) return undefined;
	const rawCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(rawCalls) || rawCalls.length === 0) return undefined;
	return parseRawToolCalls(rawCalls);
}
