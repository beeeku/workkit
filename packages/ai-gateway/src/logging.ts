import type { AiInput, AiOutput, Gateway, LoggedGateway, LoggingConfig, RunOptions } from "./types";

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

		providers(): string[] {
			return gateway.providers();
		},

		defaultProvider(): string {
			return gateway.defaultProvider();
		},
	};
}
