import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { EnvSchema, InferEnv } from "@workkit/env";
import { ValidationError } from "@workkit/errors";
import type { ValidationIssue } from "@workkit/errors";
import { createEnvFactory } from "./env";
import type { ActionFunctionArgs, ActionWithBodyOptions, ActionWithoutBodyOptions } from "./types";

/**
 * Options for createAction.
 */
export interface CreateActionOptions<T extends EnvSchema> {
	/** Environment schema to validate */
	env: T;
}

/**
 * Creates a typed Remix action with env validation and body parsing.
 *
 * @example
 * ```ts
 * const action = createAction(
 *   { env: { DB: d1() } },
 *   {
 *     body: z.object({ name: z.string() }),
 *     handler: async ({ env, body }) => {
 *       return { success: true }
 *     },
 *   },
 * )
 * ```
 */
export function createAction<T extends EnvSchema, TBody>(
	options: CreateActionOptions<T>,
	config: ActionWithBodyOptions<InferEnv<T>, TBody>,
): (args: ActionFunctionArgs) => Promise<Response>;

/**
 * Creates a typed Remix action with env validation, no body parsing.
 */
export function createAction<T extends EnvSchema>(
	options: CreateActionOptions<T>,
	config: ActionWithoutBodyOptions<InferEnv<T>>,
): (args: ActionFunctionArgs) => Promise<Response>;

/**
 * Creates a typed Remix action with body parsing, no env validation.
 */
export function createAction<TBody>(
	config: ActionWithBodyOptions<Record<string, unknown>, TBody>,
): (args: ActionFunctionArgs) => Promise<Response>;

/**
 * Creates a typed Remix action without body parsing or env validation.
 */
export function createAction(
	config: ActionWithoutBodyOptions<Record<string, unknown>>,
): (args: ActionFunctionArgs) => Promise<Response>;

export function createAction<T extends EnvSchema, TBody>(
	optionsOrConfig:
		| CreateActionOptions<T>
		| ActionWithBodyOptions<Record<string, unknown>, TBody>
		| ActionWithoutBodyOptions<Record<string, unknown>>,
	config?: ActionWithBodyOptions<InferEnv<T>, TBody> | ActionWithoutBodyOptions<InferEnv<T>>,
): (args: ActionFunctionArgs) => Promise<Response> {
	// Determine if first arg is options or config
	const hasEnvSchema = "env" in optionsOrConfig && !("handler" in optionsOrConfig);

	if (hasEnvSchema) {
		const options = optionsOrConfig as CreateActionOptions<T>;
		const actionConfig = config!;
		const getEnv = createEnvFactory(options.env);

		return async (args: ActionFunctionArgs): Promise<Response> => {
			const env = getEnv(args.context);

			if ("body" in actionConfig && actionConfig.body) {
				const bodyConfig = actionConfig as ActionWithBodyOptions<InferEnv<T>, TBody>;
				const parsedBody = await parseBody<TBody>(args.request, bodyConfig.body);
				const result = await bodyConfig.handler({
					request: args.request,
					params: args.params as Record<string, string | undefined>,
					env,
					body: parsedBody as TBody,
					context: args.context,
				});
				return toResponse(result);
			}

			const noBodyConfig = actionConfig as ActionWithoutBodyOptions<InferEnv<T>>;
			const result = await noBodyConfig.handler({
				request: args.request,
				params: args.params as Record<string, string | undefined>,
				env,
				body: undefined,
				context: args.context,
			});
			return toResponse(result);
		};
	}

	// No env schema — config is the first arg
	const actionConfig = optionsOrConfig as
		| ActionWithBodyOptions<Record<string, unknown>, TBody>
		| ActionWithoutBodyOptions<Record<string, unknown>>;

	return async (args: ActionFunctionArgs): Promise<Response> => {
		const env = args.context.cloudflare.env;

		if ("body" in actionConfig && actionConfig.body) {
			const bodyConfig = actionConfig as ActionWithBodyOptions<Record<string, unknown>, TBody>;
			const parsedBody = await parseBody<TBody>(args.request, bodyConfig.body);
			const result = await bodyConfig.handler({
				request: args.request,
				params: args.params as Record<string, string | undefined>,
				env,
				body: parsedBody as TBody,
				context: args.context,
			});
			return toResponse(result);
		}

		const noBodyConfig = actionConfig as ActionWithoutBodyOptions<Record<string, unknown>>;
		const result = await noBodyConfig.handler({
			request: args.request,
			params: args.params as Record<string, string | undefined>,
			env,
			body: undefined,
			context: args.context,
		});
		return toResponse(result);
	};
}

async function parseBody<TBody>(
	request: Request,
	schema: StandardSchemaV1<unknown, TBody>,
): Promise<TBody> {
	let raw: unknown;

	const contentType = request.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		raw = await request.json();
	} else if (
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data")
	) {
		const formData = await request.formData();
		raw = Object.fromEntries(formData.entries());
	} else {
		// Try JSON as default
		try {
			raw = await request.json();
		} catch {
			raw = await request.text();
		}
	}

	const result = schema["~standard"].validate(raw);
	const resolved = result instanceof Promise ? await result : result;

	if ("issues" in resolved && resolved.issues) {
		const issues: ValidationIssue[] = resolved.issues.map(
			(issue: { path?: readonly unknown[]; message: string }) => ({
				path: (issue.path ?? []).map((p: unknown) => {
					if (typeof p === "object" && p !== null && "key" in p) {
						return String((p as { key: unknown }).key);
					}
					return String(p);
				}),
				message: issue.message,
			}),
		);
		throw new ValidationError("Request body validation failed", issues);
	}

	return (resolved as { value: TBody }).value;
}

function toResponse(value: unknown): Response {
	if (value instanceof Response) return value;
	return new Response(JSON.stringify(value), {
		headers: { "Content-Type": "application/json" },
	});
}
