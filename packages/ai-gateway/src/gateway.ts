import { ConfigError, ServiceUnavailableError, ValidationError } from "@workkit/errors";
import { buildFallbackBodyEntry, normalizeFallbackResponse } from "./fallback";
import { isFallbackModelRef, runWithFallback } from "./fallback-wrapper";
import type { FallbackModelRef } from "./fallback-wrapper";
import { executeAnthropic } from "./providers/anthropic";
import { executeCustom } from "./providers/custom";
import { executeEmbed } from "./providers/embed";
import { executeOpenAi } from "./providers/openai";
import { cfGatewayHeaders, resolveBaseUrl, withTimeoutSignal } from "./providers/shared";
import { executeWorkersAi } from "./providers/workers-ai";
import { streamProvider } from "./stream";
import type {
	AiInput,
	AiOutput,
	CfGatewayConfig,
	EmbedInput,
	EmbedOutput,
	FallbackEntry,
	Gateway,
	GatewayConfig,
	GatewayStreamEvent,
	ProviderConfig,
	ProviderMap,
	RunOptions,
} from "./types";

async function executeProvider(
	providerName: string,
	providerConfig: ProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
): Promise<AiOutput> {
	switch (providerConfig.type) {
		case "workers-ai":
			return executeWorkersAi(providerName, providerConfig, model, input, options);
		case "openai":
			return executeOpenAi(providerName, providerConfig, model, input, options, cfGateway);
		case "anthropic":
			return executeAnthropic(providerName, providerConfig, model, input, options, cfGateway);
		case "custom":
			return executeCustom(providerName, providerConfig, model, input);
	}
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

	const runString = async (
		model: string,
		input: AiInput,
		options?: RunOptions,
	): Promise<AiOutput> => {
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
	};

	return {
		async run(
			model: string | FallbackModelRef,
			input: AiInput,
			options?: RunOptions,
		): Promise<AiOutput> {
			if (isFallbackModelRef(model)) return runWithFallback(model, input, options, runString);
			return runString(model, input, options);
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

				let raw: Record<string, unknown>;
				try {
					raw = (await response.json()) as Record<string, unknown>;
				} catch (parseErr) {
					throw new ServiceUnavailableError("cf-gateway-fallback (invalid JSON)", {
						cause: parseErr,
						context: { status: response.status },
					});
				}
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
						provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1",
					),
				cfGatewayHeaders,
			);
		},

		async embed(model: string, input: EmbedInput, options?: RunOptions): Promise<EmbedOutput> {
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
				return await executeEmbed(
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

		providers(): string[] {
			return providerNames;
		},

		defaultProvider(): string {
			return config.defaultProvider;
		},
	};
}
