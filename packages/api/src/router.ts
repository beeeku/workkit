import { ValidationError, errorToResponse, isWorkkitError } from "@workkit/errors";
import { matchPath, parseQuery } from "./path";
import type {
	ApiDefinition,
	CorsConfig,
	HttpMethod,
	Middleware,
	MiddlewareNext,
	Router,
	RouterConfig,
} from "./types";
import { validate } from "./validation";

/**
 * Create a router from API definitions.
 * Handles routing, validation, serialization, error handling, and CORS.
 *
 * @example
 * ```ts
 * const router = createRouter({
 *   apis: [getUser, createUser, listPosts],
 *   onError: (err) => new Response('Internal Error', { status: 500 }),
 * })
 *
 * export default { fetch: router.fetch }
 * ```
 */
export function createRouter<TEnv = unknown>(config: RouterConfig<TEnv>): Router<TEnv> {
	const {
		apis,
		middleware: globalMiddleware = [],
		onError,
		basePath = "",
		cors,
		validateResponses = false,
	} = config;

	// Normalize base path
	const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

	const corsConfig = resolveCors(cors);

	async function fetch(request: Request, env: TEnv, _ctx?: any): Promise<Response> {
		// Handle CORS preflight
		if (request.method === "OPTIONS" && corsConfig) {
			return corsPreflightResponse(corsConfig, request);
		}

		try {
			const url = new URL(request.url);
			const method = request.method.toUpperCase() as HttpMethod;
			let pathname = url.pathname;

			// Strip base path
			if (normalizedBase && pathname.startsWith(normalizedBase)) {
				pathname = pathname.slice(normalizedBase.length) || "/";
			}

			// Find matching route
			const match = findRoute(apis, method, pathname);
			if (!match) {
				// Check if path exists but method doesn't
				const methodNotAllowed = apis.some((api) => {
					const m = matchPath(api.path, pathname);
					return m.matched;
				});

				if (methodNotAllowed) {
					const allowed = apis
						.filter((api) => {
							const m = matchPath(api.path, pathname);
							return m.matched;
						})
						.map((api) => api.method);
					const response = jsonResponse(
						{ error: { code: "METHOD_NOT_ALLOWED", message: `Method ${method} not allowed` } },
						405,
					);
					response.headers.set("Allow", [...new Set(allowed)].join(", "));
					return maybeAddCors(response, corsConfig, request);
				}

				const response = jsonResponse(
					{ error: { code: "NOT_FOUND", message: `No route matches ${method} ${pathname}` } },
					404,
				);
				return maybeAddCors(response, corsConfig, request);
			}

			const { api: apiDef, params: pathParams } = match;

			// Build middleware chain: global → route-level → handler
			const allMiddleware = [...globalMiddleware, ...apiDef.middleware] as Middleware<TEnv>[];

			const handlerFn = async (): Promise<Response> => {
				// Validate path params
				let validatedParams = pathParams;
				if (apiDef.params) {
					validatedParams = await validate(apiDef.params, pathParams, "path parameters");
				}

				// Validate query params
				let validatedQuery: Record<string, string> = parseQuery(request.url);
				if (apiDef.query) {
					validatedQuery = await validate(apiDef.query, validatedQuery, "query parameters");
				}

				// Validate body (for methods that support it)
				let validatedBody: any = undefined;
				if (apiDef.body) {
					let rawBody: unknown;
					const contentType = request.headers.get("content-type") || "";
					if (contentType.includes("application/json")) {
						try {
							rawBody = await request.json();
						} catch {
							throw new ValidationError("Invalid JSON in request body", [
								{ path: ["body"], message: "Could not parse JSON body" },
							]);
						}
					} else if (contentType.includes("application/x-www-form-urlencoded")) {
						const text = await request.text();
						rawBody = Object.fromEntries(new URLSearchParams(text));
					} else {
						try {
							rawBody = await request.json();
						} catch {
							throw new ValidationError("Request body is required", [
								{ path: ["body"], message: "Request body is required and must be valid JSON" },
							]);
						}
					}
					validatedBody = await validate(apiDef.body, rawBody, "request body");
				}

				// Call handler
				const result = await apiDef.handler({
					params: validatedParams,
					query: validatedQuery,
					body: validatedBody,
					env,
					request,
					method: apiDef.method,
					path: apiDef.path,
					headers: request.headers,
				});

				// Validate response if configured
				if (validateResponses && apiDef.response) {
					await validate(apiDef.response, result, "response");
				}

				// If handler returns a Response, pass through
				if (result instanceof Response) {
					return result;
				}

				// Serialize result as JSON
				return jsonResponse(result, 200);
			};

			// Execute middleware chain
			const response = await executeMiddleware(allMiddleware, request, env, handlerFn);

			return maybeAddCors(response, corsConfig, request);
		} catch (error) {
			// Custom error handler
			if (onError) {
				try {
					const response = await onError(error, request);
					return maybeAddCors(response, corsConfig, request);
				} catch {
					// If custom handler throws, fall through to default
				}
			}

			// WorkkitError → structured JSON response
			if (isWorkkitError(error)) {
				const response = errorToResponse(error);
				return maybeAddCors(response, corsConfig, request);
			}

			// Unknown error → 500
			const message = error instanceof Error ? error.message : "Internal server error";
			const response = jsonResponse({ error: { code: "INTERNAL_ERROR", message } }, 500);
			return maybeAddCors(response, corsConfig, request);
		}
	}

	return {
		fetch,
		routes: apis,
	};
}

// --- Internal helpers ---

interface RouteMatch {
	api: ApiDefinition<any, any, any, any, any, any, any>;
	params: Record<string, string>;
}

function findRoute(
	apis: ApiDefinition<any, any, any, any, any, any, any>[],
	method: HttpMethod,
	pathname: string,
): RouteMatch | null {
	for (const api of apis) {
		if (api.method !== method) continue;
		const match = matchPath(api.path, pathname);
		if (match.matched) {
			return { api, params: match.params };
		}
	}
	return null;
}

function jsonResponse(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function executeMiddleware<TEnv>(
	middleware: Middleware<TEnv>[],
	request: Request,
	env: TEnv,
	handler: MiddlewareNext,
): Promise<Response> {
	if (middleware.length === 0) {
		return handler();
	}

	let index = 0;

	const next = (): Promise<Response> | Response => {
		if (index >= middleware.length) {
			return handler();
		}
		const mw = middleware[index++];
		return mw(request, env, next as MiddlewareNext);
	};

	return next() as Promise<Response>;
}

function resolveCors(cors: CorsConfig | boolean | undefined): CorsConfig | null {
	if (!cors) return null;
	if (cors === true) {
		return {
			origin: "*",
			methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			maxAge: 86400,
		};
	}
	return cors;
}

function corsPreflightResponse(config: CorsConfig, request: Request): Response {
	const headers = new Headers();
	const origin = request.headers.get("Origin") || "*";

	headers.set("Access-Control-Allow-Origin", resolveOrigin(config.origin, origin));
	if (config.methods) {
		headers.set("Access-Control-Allow-Methods", config.methods.join(", "));
	}
	if (config.allowHeaders) {
		headers.set("Access-Control-Allow-Headers", config.allowHeaders.join(", "));
	}
	if (config.maxAge !== undefined) {
		headers.set("Access-Control-Max-Age", String(config.maxAge));
	}
	if (config.credentials) {
		headers.set("Access-Control-Allow-Credentials", "true");
	}

	return new Response(null, { status: 204, headers });
}

function maybeAddCors(response: Response, config: CorsConfig | null, request: Request): Response {
	if (!config) return response;

	const origin = request.headers.get("Origin") || "*";
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", resolveOrigin(config.origin, origin));
	if (config.exposeHeaders) {
		headers.set("Access-Control-Expose-Headers", config.exposeHeaders.join(", "));
	}
	if (config.credentials) {
		headers.set("Access-Control-Allow-Credentials", "true");
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function resolveOrigin(
	config: string | string[] | ((origin: string) => boolean),
	requestOrigin: string,
): string {
	if (typeof config === "string") return config;
	if (Array.isArray(config)) {
		return config.includes(requestOrigin) ? requestOrigin : config[0];
	}
	return config(requestOrigin) ? requestOrigin : "";
}
