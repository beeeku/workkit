import { BindingNotFoundError, ServiceUnavailableError, TimeoutError } from "@workkit/errors";
import type { AiBinding, FallbackEntry, FallbackResult, RunOptions } from "./types";

/** Options for fallback chain execution */
export interface FallbackOptions extends RunOptions {
	/** Called when a model fails, before trying the next one */
	onFallback?: (model: string, error: unknown, nextModel: string) => void;
}

/**
 * Try multiple models in order, falling back on error or timeout.
 *
 * @param binding - The AI binding from the worker environment
 * @param models - Ordered list of models to try
 * @param inputs - Model input parameters
 * @param options - Optional fallback configuration
 * @returns The result from the first successful model
 * @throws {ServiceUnavailableError} If all models fail
 * @throws {BindingNotFoundError} If the binding is nullish
 *
 * @example
 * ```ts
 * const result = await fallback(env.AI, [
 *   { model: '@cf/meta/llama-3.1-70b-instruct', timeout: 5000 },
 *   { model: '@cf/meta/llama-3.1-8b-instruct', timeout: 10000 },
 *   { model: '@cf/mistral/mistral-7b-instruct-v0.2' },
 * ], {
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 * ```
 *
 * @deprecated Use `gateway.runFallback(entries, input, options)` from
 * `@workkit/ai-gateway` for server-side fallback via the Cloudflare Universal
 * Endpoint. For client-side Workers-AI-only fallback, chain calls manually
 * with try/catch. See ADR-001; tracked in #63.
 */
export async function fallback<T = unknown>(
	binding: AiBinding,
	models: FallbackEntry[],
	inputs: Record<string, unknown>,
	options?: FallbackOptions,
): Promise<FallbackResult<T>> {
	if (!binding) {
		throw new BindingNotFoundError("AI");
	}

	if (models.length === 0) {
		throw new ServiceUnavailableError("AI fallback chain (no models provided)");
	}

	const attempted: string[] = [];
	const errors: Array<{ model: string; error: unknown }> = [];

	for (let i = 0; i < models.length; i++) {
		const entry = models[i]!;
		attempted.push(entry.model);

		try {
			const data = await runWithTimeout<T>(
				binding,
				entry.model,
				inputs,
				entry.timeout,
				options?.signal,
				options?.gateway ? { gateway: options.gateway } : undefined,
			);

			return {
				data,
				model: entry.model,
				attempted,
				attempts: i + 1,
			};
		} catch (err) {
			errors.push({ model: entry.model, error: err });

			// If this isn't the last model, call onFallback
			if (i < models.length - 1 && options?.onFallback) {
				options.onFallback(entry.model, err, models[i + 1]!.model);
			}
		}
	}

	// All models failed
	const modelNames = models.map((m) => m.model).join(", ");
	throw new ServiceUnavailableError(`AI fallback chain exhausted (tried: ${modelNames})`);
}

async function runWithTimeout<T>(
	binding: AiBinding,
	model: string,
	inputs: Record<string, unknown>,
	timeout?: number,
	signal?: AbortSignal,
	extraOptions?: Record<string, unknown>,
): Promise<T> {
	if (!timeout) {
		const runOptions: Record<string, unknown> = { ...extraOptions };
		if (signal) runOptions.signal = signal;
		return binding.run(model, inputs, runOptions) as Promise<T>;
	}

	const abortController = new AbortController();

	// Combine with external signal
	if (signal) {
		if (signal.aborted) {
			throw signal.reason ?? new Error("Aborted");
		}
		signal.addEventListener("abort", () => {
			abortController.abort(signal.reason);
		});
	}

	const timeoutId = setTimeout(() => {
		abortController.abort(new TimeoutError(`AI model ${model}`, timeout));
	}, timeout);

	try {
		const runOptions: Record<string, unknown> = { ...extraOptions, signal: abortController.signal };
		const result = (await binding.run(model, inputs, runOptions)) as T;
		clearTimeout(timeoutId);
		return result;
	} catch (err) {
		clearTimeout(timeoutId);

		// Unwrap abort errors that wrap our TimeoutError
		if (err instanceof DOMException && err.name === "AbortError") {
			throw new TimeoutError(`AI model ${model}`, timeout);
		}

		throw err;
	}
}
