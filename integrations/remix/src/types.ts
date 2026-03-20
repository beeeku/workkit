/**
 * Minimal Remix type interfaces.
 * We define our own to avoid depending on @remix-run packages.
 * These match the shapes Remix uses for loader/action function arguments.
 */

/**
 * Cloudflare-specific context shape passed through Remix's context.
 */
export interface CloudflareLoadContext {
	cloudflare: {
		env: Record<string, unknown>;
		cf?: IncomingRequestCfProperties;
		ctx: ExecutionContext;
	};
	[key: string]: unknown;
}

/**
 * Arguments passed to a Remix loader function.
 */
export interface LoaderFunctionArgs {
	request: Request;
	params: Record<string, string | undefined>;
	context: CloudflareLoadContext;
}

/**
 * Arguments passed to a Remix action function.
 */
export interface ActionFunctionArgs {
	request: Request;
	params: Record<string, string | undefined>;
	context: CloudflareLoadContext;
}

/**
 * A Remix loader function signature.
 */
export type LoaderFunction = (args: LoaderFunctionArgs) => Response | Promise<Response>;

/**
 * A Remix action function signature.
 */
export type ActionFunction = (args: ActionFunctionArgs) => Response | Promise<Response>;

/**
 * Typed loader handler arguments with validated env.
 */
export interface TypedLoaderArgs<TEnv> {
	request: Request;
	params: Record<string, string | undefined>;
	env: TEnv;
	context: CloudflareLoadContext;
}

/**
 * Typed action handler arguments with validated env and parsed body.
 */
export interface TypedActionArgs<TEnv, TBody = unknown> {
	request: Request;
	params: Record<string, string | undefined>;
	env: TEnv;
	body: TBody;
	context: CloudflareLoadContext;
}

/**
 * Options for createAction when body validation is provided.
 */
export interface ActionWithBodyOptions<TEnv, TBody> {
	/** Standard Schema validator for the request body */
	body: import("@standard-schema/spec").StandardSchemaV1<unknown, TBody>;
	/** The action handler */
	handler: (args: TypedActionArgs<TEnv, TBody>) => unknown | Promise<unknown>;
}

/**
 * Options for createAction without body validation.
 */
export interface ActionWithoutBodyOptions<TEnv> {
	/** The action handler */
	handler: (args: TypedActionArgs<TEnv, undefined>) => unknown | Promise<unknown>;
}

/**
 * Options for createErrorHandler.
 */
export interface ErrorHandlerOptions {
	/** Handle WorkkitError instances specifically */
	onWorkkitError?: (error: import("@workkit/errors").WorkkitError) => Response | Promise<Response>;
	/** Handle non-WorkkitError errors */
	onError?: (error: Error) => Response | Promise<Response>;
	/** Include stack traces in error responses */
	includeStack?: boolean;
}

/**
 * Cloudflare context result from getCFContext.
 */
export interface CFContext {
	/** The waitUntil function for extending request lifetime */
	waitUntil: ExecutionContext["waitUntil"];
	/** The passThroughOnException function */
	passThroughOnException: ExecutionContext["passThroughOnException"];
	/** Cloudflare request properties (country, colo, etc.) */
	cf?: IncomingRequestCfProperties;
}
