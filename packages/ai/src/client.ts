import { BindingNotFoundError } from "@workkit/errors";
import type { AiBinding, AiResult, RunOptions } from "./types";

/**
 * Typed AI client that wraps a Cloudflare Workers AI binding.
 *
 * @example
 * ```ts
 * const client = ai(env.AI)
 * const result = await client.run('@cf/meta/llama-3.1-8b-instruct', {
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 * ```
 */
export interface WorkkitAiClient {
	/**
	 * Run inference on a model.
	 *
	 * @param model - The model identifier
	 * @param inputs - Model-specific input parameters
	 * @param options - Optional run configuration
	 * @returns The model output wrapped in an AiResult
	 */
	run<T = unknown>(
		model: string,
		inputs: Record<string, unknown>,
		options?: RunOptions,
	): Promise<AiResult<T>>;
}

/**
 * Create a typed AI client from a Cloudflare Workers AI binding.
 *
 * @param binding - The AI binding from the worker environment (env.AI)
 * @returns A typed AI client
 * @throws {BindingNotFoundError} If the binding is nullish
 */
export function ai(binding: AiBinding): WorkkitAiClient {
	if (!binding) {
		throw new BindingNotFoundError("AI");
	}

	return {
		async run<T = unknown>(
			model: string,
			inputs: Record<string, unknown>,
			options?: RunOptions,
		): Promise<AiResult<T>> {
			const runOptions: Record<string, unknown> = {};

			if (options?.gateway) {
				runOptions.gateway = options.gateway;
			}

			if (options?.signal) {
				runOptions.signal = options.signal;
			}

			const data = (await binding.run(model, inputs, runOptions)) as T;

			return { data, model };
		},
	};
}
