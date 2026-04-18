import { ServiceUnavailableError, TimeoutError, ValidationError } from "@workkit/errors";
import type {
	AnthropicProviderConfig,
	CfGatewayConfig,
	CustomProviderConfig,
	EmbedInput,
	EmbedOutput,
	OpenAiProviderConfig,
	ProviderConfig,
	RunOptions,
	WorkersAiProviderConfig,
} from "../types";
import { cfGatewayHeaders, resolveBaseUrl } from "./shared";

/** Dispatch an embed request to the appropriate provider implementation. */
export async function executeEmbed(
	providerName: string,
	providerConfig: ProviderConfig,
	model: string,
	input: EmbedInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<EmbedOutput> {
	switch (providerConfig.type) {
		case "workers-ai":
			return embedWorkersAi(providerName, providerConfig, model, input);
		case "openai":
			return embedOpenAi(providerName, providerConfig, model, input, options, cfGateway);
		case "anthropic":
			return embedAnthropic(providerName, providerConfig);
		case "custom":
			return embedCustom(providerName, providerConfig, model, input);
	}
}

// ─── Workers AI ──────────────────────────────────────────────

async function embedWorkersAi(
	providerName: string,
	providerConfig: WorkersAiProviderConfig,
	model: string,
	input: EmbedInput,
): Promise<EmbedOutput> {
	const texts = toArray(input);
	try {
		const raw = (await providerConfig.binding.run(model, { text: texts })) as Record<
			string,
			unknown
		>;
		const data = Array.isArray(raw?.data) ? (raw.data as number[][]) : [];
		return {
			vectors: data,
			raw,
			provider: providerName,
			model,
		};
	} catch (err) {
		throw new ServiceUnavailableError("workers-ai embed", {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

// ─── OpenAI ──────────────────────────────────────────────────

async function embedOpenAi(
	providerName: string,
	providerConfig: OpenAiProviderConfig,
	model: string,
	input: EmbedInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<EmbedOutput> {
	const baseUrl = resolveBaseUrl(
		"openai",
		providerConfig.baseUrl,
		cfGateway,
		"https://api.openai.com/v1",
	);
	const texts = toArray(input);
	const signal = options?.signal;
	try {
		const response = await fetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${providerConfig.apiKey}`,
				...cfGatewayHeaders(cfGateway),
			},
			body: JSON.stringify({ model, input: texts }),
			signal,
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "unknown error");
			throw new ServiceUnavailableError(`openai embed (${response.status})`, {
				context: { provider: providerName, model, status: response.status, body: errorBody },
			});
		}

		const raw = (await response.json()) as Record<string, unknown>;
		const data = raw.data as Array<{ embedding: number[]; index?: number }> | undefined;
		// If every item has an `index`, sort by it so vectors stay aligned even
		// when a provider returns them out of order. If any item lacks `index`,
		// preserve response order (treating "missing" as 0 would reorder items
		// ahead of legitimately-indexed ones).
		const allIndexed = Array.isArray(data) && data.every((d) => typeof d.index === "number");
		const ordered = Array.isArray(data)
			? allIndexed
				? [...data].sort((a, b) => (a.index as number) - (b.index as number))
				: data
			: [];
		const vectors = ordered.map((d) => d.embedding);
		const usage = raw.usage as Record<string, unknown> | undefined;
		const inputTokens =
			usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
		return {
			vectors,
			raw,
			usage: inputTokens !== undefined ? { inputTokens } : undefined,
			provider: providerName,
			model,
		};
	} catch (err) {
		if (err instanceof ServiceUnavailableError) throw err;
		// Match executeOpenAi's abort handling: only classify as TimeoutError
		// when the caller set a timeout; rethrow bare user-aborts as-is so
		// withRetry doesn't treat user cancellations as retryable.
		if (signal?.aborted) {
			if (options?.timeout !== undefined) {
				throw new TimeoutError(`openai embed for ${model}`, options.timeout, {
					cause: err,
					context: { provider: providerName, model },
				});
			}
			throw err;
		}
		throw new ServiceUnavailableError("openai embed", {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

// ─── Anthropic ──────────────────────────────────────────────

function embedAnthropic(
	providerName: string,
	_providerConfig: AnthropicProviderConfig,
): Promise<EmbedOutput> {
	// Anthropic does not expose a public embeddings endpoint. Fail loudly.
	throw new ValidationError("Anthropic does not support embeddings", [
		{
			path: ["provider", providerName],
			message: "Use Workers AI (bge-*) or OpenAI (text-embedding-*) for embeddings.",
		},
	]);
}

// ─── Custom ─────────────────────────────────────────────────

async function embedCustom(
	providerName: string,
	providerConfig: CustomProviderConfig,
	model: string,
	input: EmbedInput,
): Promise<EmbedOutput> {
	if (!providerConfig.embed) {
		throw new ValidationError(`custom provider "${providerName}" does not implement embed()`, [
			{
				path: ["provider", providerName],
				message: "Supply `embed: (model, input) => EmbedOutput` on the provider config.",
			},
		]);
	}
	try {
		return await providerConfig.embed(model, input);
	} catch (err) {
		throw new ServiceUnavailableError(`custom provider "${providerName}" embed`, {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}

// ─── Helpers ────────────────────────────────────────────────

function toArray(input: EmbedInput): string[] {
	if (Array.isArray(input.text)) return input.text;
	return [input.text];
}
