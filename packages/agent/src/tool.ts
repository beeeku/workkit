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

async function validate<T>(
	toolName: string,
	schema: StandardSchemaV1<T>,
	value: unknown,
): Promise<T> {
	const result = await schema["~standard"].validate(value);
	if (result.issues) {
		throw new ToolValidationError(
			toolName,
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
 * Race `promise` against `tool.timeoutMs`. Clears the timer when `promise`
 * settles first so a long-tail timer never lingers. Aborts the caller-side
 * `AbortController` so handlers that consume `ctx.signal` can stop their
 * own work when timed out (background side effects in handlers that ignore
 * the signal cannot be helped from here — document that loudly).
 */
async function withTimeout<T>(
	tool: Tool,
	abortOnTimeout: AbortController,
	promise: Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			abortOnTimeout.abort(new TimeoutError(`tool:${tool.name}`, tool.timeoutMs));
			reject(new TimeoutError(`tool:${tool.name}`, tool.timeoutMs));
		}, tool.timeoutMs);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Run a registered tool against raw arguments from the model. Validates
 * input via Standard Schema, enforces the tool's timeout (clearing the
 * timer on success so it does not leak), validates output if a schema is
 * supplied, and returns the string content the loop should feed back to
 * the model. Throws `ToolValidationError`, `TimeoutError`, or the
 * handler's own error.
 */
export async function runTool(tool: Tool, args: unknown, ctx: ToolCtx): Promise<string> {
	const validated = await validate(tool.name, tool.input as StandardSchemaV1<unknown>, args);

	// Combine caller signal with our timeout-driven controller so handlers
	// that respect ctx.signal are abortable from both sides.
	const timeoutCtrl = new AbortController();
	const combined = combineSignals(ctx.signal, timeoutCtrl.signal);
	const handlerCtx: ToolCtx = { ...ctx, signal: combined };

	const handlerPromise = (tool.handler as (i: unknown, c: ToolCtx) => Promise<unknown>)(
		validated,
		handlerCtx,
	);
	const result = await withTimeout(tool, timeoutCtrl, handlerPromise);

	if (tool.output) {
		await validate(tool.name, tool.output as StandardSchemaV1<unknown>, result);
	}

	if (typeof result === "string") return result;
	try {
		return JSON.stringify(result);
	} catch {
		return String(result);
	}
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
	if (!a) return b;
	if (a.aborted) return a;
	if (b.aborted) return b;
	const combined = new AbortController();
	const onAbortA = () => combined.abort((a as AbortSignal & { reason?: unknown }).reason);
	const onAbortB = () => combined.abort((b as AbortSignal & { reason?: unknown }).reason);
	a.addEventListener("abort", onAbortA, { once: true });
	b.addEventListener("abort", onAbortB, { once: true });
	return combined.signal;
}
