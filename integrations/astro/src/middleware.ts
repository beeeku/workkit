import { parseEnvSync } from "@workkit/env";
import type { EnvSchema } from "@workkit/env";
import { getCloudflareRuntime } from "./context";
import type { AstroMiddlewareHandler, WorkkitMiddlewareOptions } from "./types";

/**
 * Creates Astro middleware that validates environment bindings
 * on every request. If validation fails, calls the onError handler
 * (or returns a 500 by default).
 *
 * Place this in your `src/middleware.ts` to ensure all routes have
 * validated bindings before they execute.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { workkitMiddleware } from '@workkit/astro'
 * import { env } from './env'
 *
 * export const onRequest = workkitMiddleware({
 *   env: env.schema,
 *   onError: (error) => new Response('Config error', { status: 500 }),
 * })
 * ```
 */
export function workkitMiddleware<T extends EnvSchema>(
	options: WorkkitMiddlewareOptions<T>,
): AstroMiddlewareHandler {
	let validated = false;

	return async (context, next) => {
		if (!validated) {
			try {
				const runtime = getCloudflareRuntime(context);
				parseEnvSync(runtime.env, options.env);
				validated = true;
			} catch (error) {
				if (options.onError) {
					return options.onError(error as Error, context);
				}
				return new Response("Internal Server Error: Environment configuration invalid", {
					status: 500,
					headers: { "Content-Type": "text/plain" },
				});
			}
		}

		return next();
	};
}
