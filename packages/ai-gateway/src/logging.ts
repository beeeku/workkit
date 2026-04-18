import type {
	AiInput,
	AiOutput,
	EmbedInput,
	EmbedOutput,
	FallbackEntry,
	Gateway,
	LoggedGateway,
	LoggingConfig,
	RunOptions,
} from "./types";

/**
 * Wrap a gateway with request/response logging.
 *
 * Fires callbacks on request start, response received, and errors.
 * Does not modify the gateway behavior — purely observational.
 *
 * @example
 * ```ts
 * const logged = withLogging(gateway, {
 *   onRequest: (model, input) => console.log(`Requesting ${model}`),
 *   onResponse: (model, output, ms) => console.log(`${model} in ${ms}ms`),
 *   onError: (model, err) => console.error(`${model} failed:`, err),
 * })
 * ```
 */
export function withLogging(gateway: Gateway, config: LoggingConfig): LoggedGateway {
	const innerFallback = gateway.runFallback?.bind(gateway);
	const innerStream = gateway.stream?.bind(gateway);
	const innerEmbed = gateway.embed?.bind(gateway);

	return {
		async run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput> {
			config.onRequest?.(model, input);

			const start = Date.now();
			try {
				const result = await gateway.run(model, input, options);
				const duration = Date.now() - start;
				config.onResponse?.(model, result, duration);
				return result;
			} catch (err) {
				config.onError?.(model, err);
				throw err;
			}
		},

		runFallback: innerFallback
			? async (
					entries: FallbackEntry[],
					input: AiInput,
					options?: RunOptions,
				): Promise<AiOutput> => {
					const label = entries.map((e) => e.model).join(",") || "(empty)";
					config.onRequest?.(label, input);
					const start = Date.now();
					try {
						const result = await innerFallback(entries, input, options);
						config.onResponse?.(result.model, result, Date.now() - start);
						return result;
					} catch (err) {
						config.onError?.(label, err);
						throw err;
					}
				}
			: undefined,

		// Streams fire onRequest at start and onError on connect failure. Per-event
		// logging is intentionally omitted — consumers tap the stream themselves.
		stream: innerStream
			? async (model, input, options) => {
					config.onRequest?.(model, input);
					try {
						return await innerStream(model, input, options);
					} catch (err) {
						config.onError?.(model, err);
						throw err;
					}
				}
			: undefined,

		embed: innerEmbed
			? async (
					model: string,
					input: EmbedInput,
					options?: RunOptions,
				): Promise<EmbedOutput> => {
					config.onRequest?.(model, input as unknown as AiInput);
					const start = Date.now();
					try {
						const result = await innerEmbed(model, input, options);
						// Log via onResponse using a synthetic AiOutput-shaped object so
						// existing handlers keep working. usage is preserved.
						config.onResponse?.(
							model,
							{
								text: undefined,
								raw: result.raw,
								usage: result.usage
									? { inputTokens: result.usage.inputTokens, outputTokens: 0 }
									: undefined,
								provider: result.provider,
								model: result.model,
							},
							Date.now() - start,
						);
						return result;
					} catch (err) {
						config.onError?.(model, err);
						throw err;
					}
				}
			: undefined,

		providers(): string[] {
			return gateway.providers();
		},

		defaultProvider(): string {
			return gateway.defaultProvider();
		},
	};
}
