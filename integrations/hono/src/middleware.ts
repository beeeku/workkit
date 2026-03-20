import { parseEnv } from "@workkit/env";
import type { EnvSchema, InferEnv } from "@workkit/env";
import type { MiddlewareHandler } from "hono";
import type { WorkkitEnv, WorkkitOptions } from "./types";

/**
 * Main workkit middleware — validates environment bindings on first request
 * and stores the parsed, typed env in Hono's context.
 *
 * Validation runs once (on the first request) and the result is cached
 * for subsequent requests within the same Worker invocation.
 *
 * @example
 * ```ts
 * const app = new Hono()
 * app.use(workkit({ env: { API_KEY: z.string().min(1) } }))
 * app.get('/', (c) => {
 *   const env = c.get('workkit:env') // typed
 * })
 * ```
 */
export function workkit<T extends EnvSchema>(
	options: WorkkitOptions<T>,
): MiddlewareHandler<WorkkitEnv<T>> {
	let cachedEnv: InferEnv<T> | null = null;

	return async (c, next) => {
		if (!cachedEnv) {
			const rawEnv = c.env as Record<string, unknown>;
			cachedEnv = await parseEnv(rawEnv, options.env);
		}

		c.set("workkit:env", cachedEnv);
		c.set("workkit:envValidated", true);

		await next();
	};
}
