import { toRestError } from "./errors";
// src/rest.ts
import type { ToolRegistry } from "./registry";
import type { Middleware } from "./types";
import { validateInput } from "./validation";

// ─── Types ────────────────────────────────────────────────────

export interface RestHandlerConfig<TEnv = unknown> {
	tools: ToolRegistry<TEnv>;
	basePath?: string;
	middleware?: Middleware<TEnv>[];
}

export interface RestHandler<TEnv = unknown> {
	handleRequest(request: Request, env: TEnv, ctx: ExecutionContext): Promise<Response | null>;
}

// ─── createRestHandler ────────────────────────────────────────

export function createRestHandler<TEnv = unknown>(
	config: RestHandlerConfig<TEnv>,
): RestHandler<TEnv> {
	const basePath = config.basePath ?? "/api";
	const serverMiddleware = config.middleware ?? [];
	const toolPrefix = `${basePath}/tools/`;

	return {
		async handleRequest(request, env, ctx) {
			const url = new URL(request.url);
			const pathname = url.pathname;

			// Only handle paths matching {basePath}/tools/{toolName}
			if (!pathname.startsWith(toolPrefix)) {
				return null;
			}

			const toolName = pathname.slice(toolPrefix.length);
			// Reject if there are additional path segments
			if (!toolName || toolName.includes("/")) {
				return null;
			}

			// Run server-level middleware chain wrapping the core handler
			const coreHandler = async (): Promise<Response> => {
				return handleToolRequest(request, env, ctx, toolName, config.tools);
			};

			return runMiddlewareChain(request, env, serverMiddleware, coreHandler);
		},
	};
}

// ─── Internal Helpers ─────────────────────────────────────────

async function handleToolRequest<TEnv>(
	request: Request,
	env: TEnv,
	ctx: ExecutionContext,
	toolName: string,
	tools: ToolRegistry<TEnv>,
): Promise<Response> {
	// Look up tool
	const tool = tools.get(toolName);
	if (!tool) {
		return jsonResponse({ error: { code: "NOT_FOUND", message: "Tool not found" } }, 404);
	}

	// Parse body
	let rawInput: unknown;
	try {
		rawInput = await request.json();
	} catch {
		return jsonResponse(
			{ error: { code: "PARSE_ERROR", message: "Request body must be valid JSON" } },
			400,
		);
	}

	// Validate input
	const validation = await validateInput(tool.input, rawInput);
	if (!validation.ok) {
		const firstIssue = validation.error.issues[0];
		return jsonResponse(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: firstIssue?.message ?? "Validation failed",
					issues: validation.error.issues,
				},
			},
			400,
		);
	}

	// Build handler context. Forward the request's own abort signal when available
	// (e.g. client disconnect in Cloudflare Workers) and always abort after the
	// handler finishes so any in-flight cancellable work is cleaned up promptly.
	const abortController = new AbortController();
	// Forward upstream abort (client disconnect) into our controller.
	const upstreamSignal = (request as any).signal as AbortSignal | undefined;
	const forwardAbort = () => abortController.abort(upstreamSignal?.reason);
	if (upstreamSignal) {
		if (upstreamSignal.aborted) {
			abortController.abort(upstreamSignal.reason);
		} else {
			upstreamSignal.addEventListener("abort", forwardAbort, { once: true });
		}
	}

	const handlerCtx = {
		input: validation.value,
		env,
		ctx,
		request,
		log: {
			debug: (...args: unknown[]) => console.debug(...args),
			info: (...args: unknown[]) => console.info(...args),
			warn: (...args: unknown[]) => console.warn(...args),
			error: (...args: unknown[]) => console.error(...args),
		},
		reportProgress: async (_progress: number, _total?: number) => {},
		signal: abortController.signal,
	};

	// Core tool execution (after tool-level middleware)
	const toolCore = async (): Promise<Response> => {
		try {
			const result = await tool.handler(handlerCtx as any);
			return jsonResponse({ result }, 200);
		} catch (err) {
			return toRestError(err);
		} finally {
			// Signal cancellation once the request lifecycle ends so any
			// downstream work that checks handlerCtx.signal can stop promptly.
			abortController.abort();
			if (upstreamSignal) {
				upstreamSignal.removeEventListener("abort", forwardAbort);
			}
		}
	};

	// Run tool-level middleware chain
	return runMiddlewareChain(request, env, tool.middleware, toolCore);
}

async function runMiddlewareChain<TEnv>(
	request: Request,
	env: TEnv,
	middleware: Middleware<TEnv>[],
	core: () => Promise<Response>,
): Promise<Response> {
	if (middleware.length === 0) {
		return core();
	}

	// Build chain from the end
	// const index = middleware.length - 1; // removed: unused

	const runAt = async (i: number): Promise<Response> => {
		if (i >= middleware.length) {
			return core();
		}
		return middleware[i]!(request, env, () => runAt(i + 1));
	};

	return runAt(0);
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
