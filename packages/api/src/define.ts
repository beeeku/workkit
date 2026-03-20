import type { ApiConfig, ApiDefinition, HttpMethod, StandardSchemaV1 } from "./types";

/**
 * Define a typed API endpoint.
 *
 * Uses Standard Schema v1 for input/output validation.
 * Compatible with Zod, Valibot, ArkType, and any Standard Schema provider.
 *
 * @example
 * ```ts
 * import { api } from '@workkit/api'
 * import { z } from 'zod'
 *
 * export const getUser = api({
 *   method: 'GET',
 *   path: '/users/:id',
 *   params: z.object({ id: z.string() }),
 *   response: z.object({ id: z.string(), name: z.string() }),
 *   handler: async ({ params }) => {
 *     return { id: params.id, name: 'Alice' }
 *   },
 * })
 * ```
 */
export function api<
	TMethod extends HttpMethod,
	TPath extends string,
	TParams extends StandardSchemaV1 | undefined = undefined,
	TQuery extends StandardSchemaV1 | undefined = undefined,
	TBody extends StandardSchemaV1 | undefined = undefined,
	TResponse extends StandardSchemaV1 | undefined = undefined,
	TEnv = unknown,
>(
	config: ApiConfig<TMethod, TPath, TParams, TQuery, TBody, TResponse, TEnv>,
): ApiDefinition<TMethod, TPath, TParams, TQuery, TBody, TResponse, TEnv> {
	// Validate config at definition time
	if (!config.method) {
		throw new Error("API definition requires a method");
	}
	if (!config.path) {
		throw new Error("API definition requires a path");
	}
	if (!config.path.startsWith("/")) {
		throw new Error(`API path must start with '/': ${config.path}`);
	}
	if (!config.handler) {
		throw new Error("API definition requires a handler");
	}
	if (config.body && (config.method === "GET" || config.method === "HEAD")) {
		throw new Error(`${config.method} endpoints cannot have a body schema`);
	}

	return {
		__brand: "ApiDefinition",
		method: config.method,
		path: config.path,
		params: config.params,
		query: config.query,
		body: config.body,
		response: config.response,
		handler: config.handler,
		middleware: config.middleware ?? [],
	};
}

/**
 * Type guard: is this value an ApiDefinition?
 */
export function isApiDefinition(value: unknown): value is ApiDefinition {
	return (
		typeof value === "object" &&
		value !== null &&
		"__brand" in value &&
		(value as any).__brand === "ApiDefinition"
	);
}
