import type { StandardSchemaV1 } from "@standard-schema/spec";
import { TimeoutError } from "@workkit/errors";
import { ToolValidationError } from "./errors";
import type { Tool, ToolCtx } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface DefineToolOptions<TInput, TOutput> {
	name: string;
	description: string;
	input: StandardSchemaV1<TInput>;
	output?: StandardSchemaV1<TOutput>;
	handler: (input: TInput, ctx: ToolCtx) => Promise<TOutput>;
	timeoutMs?: number;
}

/**
 * Define a tool with Standard-Schema-validated input (and optional output).
 * The returned `Tool` is what `defineAgent({ tools: [...] })` expects.
 */
export function tool<TInput, TOutput = unknown>(
	options: DefineToolOptions<TInput, TOutput>,
): Tool<TInput, TOutput> {
	if (!options.name || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(options.name)) {
		throw new Error(
			`tool name must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/, got: ${JSON.stringify(options.name)}`,
		);
	}
	return {
		name: options.name,
		description: options.description,
		input: options.input,
		output: options.output,
		handler: options.handler,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		kind: "tool",
	};
}

async function validate<T>(schema: StandardSchemaV1<T>, value: unknown): Promise<T> {
	const result = await schema["~standard"].validate(value);
	if (result.issues) {
		throw new ToolValidationError(
			"<unnamed>",
			result.issues.map((i) => ({
				path: (i.path ?? []).map((p) =>
					typeof p === "object" && p !== null && "key" in p
						? (p.key as PropertyKey)
						: (p as PropertyKey),
				),
				message: i.message,
			})),
		);
	}
	return result.value as T;
}

/**
 * Run a registered tool against raw arguments from the model. Validates
 * input via Standard Schema, enforces the tool's timeout, validates output
 * if a schema is supplied, and returns the string content the loop should
 * feed back to the model. Throws `ToolValidationError`, `TimeoutError`, or
 * the handler's own error.
 */
export async function runTool(tool: Tool, args: unknown, ctx: ToolCtx): Promise<string> {
	let validated: unknown;
	try {
		validated = await validate(tool.input as StandardSchemaV1<unknown>, args);
	} catch (err) {
		if (err instanceof ToolValidationError) {
			// rebrand with the actual tool name
			throw new ToolValidationError(
				tool.name,
				err.issues.map((i) => ({ path: i.path, message: i.message })),
			);
		}
		throw err;
	}

	const handlerPromise = (tool.handler as (i: unknown, c: ToolCtx) => Promise<unknown>)(
		validated,
		ctx,
	);
	const timed = await Promise.race([
		handlerPromise,
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new TimeoutError(`tool:${tool.name}`, tool.timeoutMs)),
				tool.timeoutMs,
			),
		),
	]);

	if (tool.output) {
		await validate(tool.output as StandardSchemaV1<unknown>, timed);
	}

	if (typeof timed === "string") return timed;
	try {
		return JSON.stringify(timed);
	} catch {
		return String(timed);
	}
}
