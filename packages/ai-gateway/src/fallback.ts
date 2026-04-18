import { ValidationError } from "@workkit/errors";
import {
	buildAnthropicBody,
	extractAnthropicText,
	extractAnthropicToolCalls,
	extractAnthropicUsage,
} from "./providers/anthropic";
import {
	buildOpenAiBody,
	extractOpenAiText,
	extractOpenAiToolCalls,
	extractOpenAiUsage,
} from "./providers/openai";
import type {
	AiInput,
	AiOutput,
	FallbackEntry,
	ProviderConfig,
	ProviderMap,
	RunOptions,
} from "./types";

/** Build one CF Universal Endpoint entry for an openai or anthropic provider. */
export function buildFallbackBodyEntry(
	entry: FallbackEntry,
	providerConfig: ProviderConfig,
	input: AiInput,
	options: RunOptions | undefined,
): Record<string, unknown> {
	if (providerConfig.type === "anthropic") {
		return {
			provider: "anthropic",
			endpoint: "v1/messages",
			headers: {
				"x-api-key": providerConfig.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			query: buildAnthropicBody(entry.model, input, options?.responseFormat, options?.toolOptions),
		};
	}
	if (providerConfig.type === "openai") {
		return {
			provider: "openai",
			endpoint: "chat/completions",
			headers: {
				authorization: `Bearer ${providerConfig.apiKey}`,
				"content-type": "application/json",
			},
			query: buildOpenAiBody(entry.model, input, options?.responseFormat, options?.toolOptions),
		};
	}
	throw new ValidationError(`Unsupported provider type "${providerConfig.type}"`, []);
}

/** Detect the provider from response body shape and normalize to AiOutput. */
export function normalizeFallbackResponse(
	raw: Record<string, unknown>,
	entries: [FallbackEntry, ...FallbackEntry[]],
	providers: ProviderMap,
): AiOutput {
	const looksAnthropic = Array.isArray(raw.content);
	const looksOpenAi = Array.isArray(raw.choices);

	const matched = entries.find((e) => {
		const type = providers[e.provider]?.type;
		if (looksAnthropic) return type === "anthropic";
		if (looksOpenAi) return type === "openai";
		return false;
	});

	if (looksAnthropic) {
		const entry = matched ?? entries[0];
		return {
			text: extractAnthropicText(raw),
			raw,
			usage: extractAnthropicUsage(raw),
			provider: entry.provider,
			model: entry.model,
			toolCalls: extractAnthropicToolCalls(raw),
		};
	}
	if (looksOpenAi) {
		const entry = matched ?? entries[0];
		return {
			text: extractOpenAiText(raw),
			raw,
			usage: extractOpenAiUsage(raw),
			provider: entry.provider,
			model: entry.model,
			toolCalls: extractOpenAiToolCalls(raw),
		};
	}

	// Unknown shape: return the first entry as best-guess metadata.
	return {
		raw,
		provider: entries[0].provider,
		model: entries[0].model,
	};
}
