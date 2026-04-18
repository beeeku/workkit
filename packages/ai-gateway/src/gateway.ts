import {
	ConfigError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";
import { streamProvider } from "./stream";
import type {
	AiInput,
	AiOutput,
	CfGatewayConfig,
	ChatMessage,
	FallbackEntry,
	Gateway,
	GatewayConfig,
	GatewayStreamEvent,
	GatewayToolCall,
	GatewayToolOptions,
	ProviderConfig,
	ProviderMap,
	RunOptions,
} from "./types";

/**
 * Resolve the effective base URL for an HTTP provider, preferring (in order):
 *   1. explicit `baseUrl` on the provider config
 *   2. CF AI Gateway URL derived from `cfGateway`
 *   3. the provider's public API default
 */
function resolveBaseUrl(
	provider: "openai" | "anthropic",
	explicit: string | undefined,
	cf: CfGatewayConfig | undefined,
	providerDefault: string,
): string {
	if (explicit) return explicit;
	if (cf) {
		const prefix = `https://gateway.ai.cloudflare.com/v1/${cf.accountId}/${cf.gatewayId}`;
		// Anthropic's native path starts with /v1/messages; the CF gateway path is
		// .../anthropic and providers append /v1/messages themselves.
		return provider === "anthropic" ? `${prefix}/anthropic/v1` : `${prefix}/openai`;
	}
	return providerDefault;
}

/** Build the cf-aig-* header set for a request, omitting undefined fields. */
function cfGatewayHeaders(cf: CfGatewayConfig | undefined): Record<string, string> {
	if (!cf) return {};
	const headers: Record<string, string> = {};
	if (cf.authToken) headers["cf-aig-authorization"] = `Bearer ${cf.authToken}`;
	if (cf.cacheTtl !== undefined) headers["cf-aig-cache-ttl"] = String(cf.cacheTtl);
	if (cf.skipCache) headers["cf-aig-skip-cache"] = "true";
	return headers;
}

/**
 * Resolve the effective AbortSignal for a request, combining an optional
 * `options.signal` with an `options.timeout` deadline. Returns a cleanup fn
 * the caller must run in a `finally` block to clear any pending timer.
 */
function withTimeoutSignal(options: RunOptions | undefined): {
	signal: AbortSignal | undefined;
	cleanup: () => void;
} {
	let signal = options?.signal;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	if (options?.timeout && !signal) {
		const controller = new AbortController();
		signal = controller.signal;
		timeoutId = setTimeout(() => controller.abort(), options.timeout);
	}
	return {
		signal,
		cleanup: () => {
			if (timeoutId) clearTimeout(timeoutId);
		},
	};
}

/**
 * Execute a request against a specific provider.
 * Each provider type has its own execution logic.
 */
async function executeProvider(
	providerName: string,
	providerConfig: ProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<AiOutput> {
	const signal = options?.signal;

	const responseFormat = options?.responseFormat;

	switch (providerConfig.type) {
		case "workers-ai": {
			try {
				const aiInput = applyWorkersAiResponseFormat(input, responseFormat);
				const finalInput = applyToolsWorkersAi(aiInput, options?.toolOptions);
				const raw = await providerConfig.binding.run(model, finalInput);
				return {
					text: typeof raw === "string" ? raw : extractText(raw),
					raw,
					usage: extractUsage(raw),
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

		case "openai": {
			const baseUrl = resolveBaseUrl(
				"openai",
				providerConfig.baseUrl,
				cfGateway,
				"https://api.openai.com/v1",
			);
			const body = buildOpenAiBody(model, input, responseFormat, options?.toolOptions);

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
				if (signal?.aborted) {
					throw new TimeoutError(`openai request for ${model}`, options?.timeout, {
						cause: err,
						context: { provider: providerName, model },
					});
				}
				throw new ServiceUnavailableError("openai", {
					cause: err,
					context: { provider: providerName, model },
				});
			}
		}

		case "anthropic": {
			const baseUrl = resolveBaseUrl(
				"anthropic",
				providerConfig.baseUrl,
				cfGateway,
				"https://api.anthropic.com/v1",
			);
			const body = buildAnthropicBody(model, input, responseFormat, options?.toolOptions);

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

		case "custom": {
			try {
				return await providerConfig.run(model, input);
			} catch (err) {
				throw new ServiceUnavailableError(`custom provider "${providerName}"`, {
					cause: err,
					context: { provider: providerName, model },
				});
			}
		}
	}
}

// --- Helpers for response format ---

function applyWorkersAiResponseFormat(
	input: AiInput,
	responseFormat?: "json" | { jsonSchema: Record<string, unknown> },
): AiInput {
	if (!responseFormat) return input;
	// Workers AI uses response_format: { type: "json_object" }
	return { ...input, response_format: { type: "json_object" } } as AiInput;
}

// --- Helpers for building request bodies ---

function buildOpenAiBody(
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

function buildAnthropicBody(
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

// --- Helpers for extracting response data ---

function extractText(raw: unknown): string | undefined {
	if (raw == null) return undefined;
	if (typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		if (typeof obj.response === "string") return obj.response;
		if (typeof obj.text === "string") return obj.text;
	}
	return undefined;
}

function extractUsage(raw: unknown): { inputTokens: number; outputTokens: number } | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const usage = obj.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
	const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
	if (input === 0 && output === 0) return undefined;
	return { inputTokens: input, outputTokens: output };
}

function extractOpenAiText(raw: Record<string, unknown>): string | undefined {
	const choices = raw.choices as Array<Record<string, unknown>> | undefined;
	if (!choices?.[0]) return undefined;
	const message = choices[0].message as Record<string, unknown> | undefined;
	return typeof message?.content === "string" ? message.content : undefined;
}

function extractOpenAiUsage(
	raw: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | undefined {
	const usage = raw.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	return {
		inputTokens: (usage.prompt_tokens as number) ?? 0,
		outputTokens: (usage.completion_tokens as number) ?? 0,
	};
}

function extractAnthropicText(raw: Record<string, unknown>): string | undefined {
	const content = raw.content as Array<Record<string, unknown>> | undefined;
	if (!content?.[0]) return undefined;
	return typeof content[0].text === "string" ? content[0].text : undefined;
}

function extractAnthropicUsage(
	raw: Record<string, unknown>,
): { inputTokens: number; outputTokens: number } | undefined {
	const usage = raw.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	return {
		inputTokens: (usage.input_tokens as number) ?? 0,
		outputTokens: (usage.output_tokens as number) ?? 0,
	};
}

// --- Tool-related helpers ---

/** Apply tool options to a Workers AI input */
function applyToolsWorkersAi(
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

/** Extract tool calls from a Workers AI response */
function extractWorkersAiToolCalls(raw: unknown): GatewayToolCall[] | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const rawCalls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(rawCalls) || rawCalls.length === 0) return undefined;

	return parseRawToolCalls(rawCalls);
}

/** Extract tool calls from an OpenAI response */
function extractOpenAiToolCalls(raw: Record<string, unknown>): GatewayToolCall[] | undefined {
	const choices = raw.choices as Array<Record<string, unknown>> | undefined;
	if (!choices?.[0]) return undefined;
	const message = choices[0].message as Record<string, unknown> | undefined;
	if (!message) return undefined;
	const rawCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
	if (!Array.isArray(rawCalls) || rawCalls.length === 0) return undefined;

	return parseRawToolCalls(rawCalls);
}

/** Extract tool calls from an Anthropic response */
function extractAnthropicToolCalls(raw: Record<string, unknown>): GatewayToolCall[] | undefined {
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

/**
 * Parse raw tool calls from Workers AI / OpenAI format.
 * Both use: `{ id, type: "function", function: { name, arguments } }`
 */
function parseRawToolCalls(rawCalls: Array<Record<string, unknown>>): GatewayToolCall[] {
	const calls: GatewayToolCall[] = [];
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

		calls.push({
			id: typeof raw.id === "string" ? raw.id : `call_${calls.length}`,
			name: fn.name,
			arguments: args,
		});
	}
	return calls;
}

/**
 * Create an AI gateway with named providers.
 *
 * The gateway provides a unified `run()` interface across all providers.
 * Use a router to automatically map model names to providers,
 * or specify the provider explicitly via `RunOptions`.
 *
 * @example
 * ```ts
 * const gateway = createGateway({
 *   providers: {
 *     'workers-ai': { type: 'workers-ai', binding: env.AI },
 *     'openai': { type: 'openai', apiKey: env.OPENAI_KEY },
 *   },
 *   defaultProvider: 'workers-ai',
 * })
 *
 * const result = await gateway.run('gpt-4', { prompt: 'Hello' }, { provider: 'openai' })
 * ```
 */
export function createGateway<P extends ProviderMap>(config: GatewayConfig<P>): Gateway {
	if (!config.providers || Object.keys(config.providers).length === 0) {
		throw new ConfigError("Gateway requires at least one provider", {
			context: { providers: Object.keys(config.providers ?? {}) },
		});
	}

	if (!config.defaultProvider) {
		throw new ConfigError("Gateway requires a default provider", {
			context: { defaultProvider: config.defaultProvider },
		});
	}

	if (!(config.defaultProvider in config.providers)) {
		throw new ConfigError(`Default provider "${config.defaultProvider}" not found in providers`, {
			context: {
				defaultProvider: config.defaultProvider,
				available: Object.keys(config.providers),
			},
		});
	}

	const providerNames = Object.keys(config.providers);

	return {
		async run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput> {
			if (!model) {
				throw new ValidationError("Model name is required", [
					{ path: ["model"], message: "Model name cannot be empty" },
				]);
			}

			const providerKey = options?.provider ?? config.defaultProvider;
			const providerConfig = config.providers[providerKey];

			if (!providerConfig) {
				throw new ConfigError(`Provider "${providerKey}" not found`, {
					context: { provider: providerKey, available: providerNames },
				});
			}

			const { signal, cleanup } = withTimeoutSignal(options);
			try {
				return await executeProvider(
					providerKey,
					providerConfig,
					model,
					input,
					signal ? { ...options, signal } : options,
					config.cfGateway,
				);
			} finally {
				cleanup();
			}
		},

		async runFallback(
			entries: FallbackEntry[],
			input: AiInput,
			options?: RunOptions,
		): Promise<AiOutput> {
			if (!config.cfGateway) {
				throw new ConfigError("runFallback requires cfGateway to be configured", {
					context: { entries: entries.map((e) => e.provider) },
				});
			}
			if (!entries || entries.length === 0) {
				throw new ValidationError("runFallback requires at least one entry", [
					{ path: ["entries"], message: "Entries array cannot be empty" },
				]);
			}

			const body = entries.map((entry) => {
				const providerConfig = config.providers[entry.provider];
				if (!providerConfig) {
					throw new ValidationError(`Provider "${entry.provider}" not found`, [
						{
							path: ["entries", entry.provider],
							message: `Unknown provider; available: ${providerNames.join(", ")}`,
						},
					]);
				}
				if (providerConfig.type !== "openai" && providerConfig.type !== "anthropic") {
					throw new ValidationError(
						`runFallback only supports openai and anthropic providers (got "${providerConfig.type}")`,
						[
							{
								path: ["entries", entry.provider],
								message: "CF Universal Endpoint does not support this provider type",
							},
						],
					);
				}
				return buildFallbackBodyEntry(entry, providerConfig, input, options);
			});

			const url = `https://gateway.ai.cloudflare.com/v1/${config.cfGateway.accountId}/${config.cfGateway.gatewayId}`;
			const { signal, cleanup } = withTimeoutSignal(options);
			try {
				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...cfGatewayHeaders(config.cfGateway),
					},
					body: JSON.stringify(body),
					signal,
				});

				if (!response.ok) {
					const errorBody = await response.text().catch(() => "unknown error");
					throw new ServiceUnavailableError(`cf-gateway-fallback (${response.status})`, {
						context: { status: response.status, body: errorBody },
					});
				}

				const raw = (await response.json()) as Record<string, unknown>;
				return normalizeFallbackResponse(
					raw,
					entries as [FallbackEntry, ...FallbackEntry[]],
					config.providers,
				);
			} finally {
				cleanup();
			}
		},

		async stream(
			model: string,
			input: AiInput,
			options?: RunOptions,
		): Promise<ReadableStream<GatewayStreamEvent>> {
			if (!model) {
				throw new ValidationError("Model name is required", [
					{ path: ["model"], message: "Model name cannot be empty" },
				]);
			}
			const providerKey = options?.provider ?? config.defaultProvider;
			const providerConfig = config.providers[providerKey];
			if (!providerConfig) {
				throw new ConfigError(`Provider "${providerKey}" not found`, {
					context: { provider: providerKey, available: providerNames },
				});
			}
			return streamProvider(
				providerConfig,
				model,
				input,
				options,
				config.cfGateway,
				(provider, explicit) =>
					resolveBaseUrl(
						provider,
						explicit,
						config.cfGateway,
						provider === "anthropic"
							? "https://api.anthropic.com/v1"
							: "https://api.openai.com/v1",
					),
				cfGatewayHeaders,
			);
		},

		providers(): string[] {
			return providerNames;
		},

		defaultProvider(): string {
			return config.defaultProvider;
		},
	};
}

/** Build one CF Universal Endpoint entry for an openai or anthropic provider. */
function buildFallbackBodyEntry(
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
function normalizeFallbackResponse(
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
