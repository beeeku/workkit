import { MCPProtocolError, toJsonRpcError, toMCPToolError } from "./errors";
import type { PromptRegistry, ResourceRegistry, ToolRegistry } from "./registry";
import { executeWithTimeout } from "./timeout";
// src/protocol.ts
import type {
	InitializeResult,
	JsonRpcRequest,
	JsonRpcResponse,
	Logger,
	ServerCapabilities,
} from "./types";
import { schemaToJsonSchema, validateInput } from "./validation";

// ─── Config ──────────────────────────────────────────────────

export interface ProtocolHandlerConfig {
	serverName: string;
	serverVersion: string;
	instructions?: string;
	tools: ToolRegistry;
	resources: ResourceRegistry;
	prompts: PromptRegistry;
}

export interface DispatchContext {
	env?: unknown;
	ctx?: ExecutionContext;
	request?: Request;
}

export interface ProtocolHandler {
	dispatch(message: JsonRpcRequest, context?: DispatchContext): Promise<JsonRpcResponse | null>;
}

// ─── Console Logger ──────────────────────────────────────────

function createConsoleLogger(): Logger {
	return {
		debug: (...args: unknown[]) => console.debug("[mcp]", ...args),
		info: (...args: unknown[]) => console.info("[mcp]", ...args),
		warn: (...args: unknown[]) => console.warn("[mcp]", ...args),
		error: (...args: unknown[]) => console.error("[mcp]", ...args),
	};
}

// ─── Response Helpers ────────────────────────────────────────

function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: string | number | null, error: MCPProtocolError): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: toJsonRpcError(error) };
}

// ─── Protocol Handler ────────────────────────────────────────

export function createProtocolHandler(config: ProtocolHandlerConfig): ProtocolHandler {
	const { serverName, serverVersion, instructions, tools, resources, prompts } = config;
	const log = createConsoleLogger();

	async function dispatch(
		message: JsonRpcRequest,
		context?: DispatchContext,
	): Promise<JsonRpcResponse | null> {
		const { method, id, params } = message;

		// Notifications (no id) — return null
		if (id === undefined || id === null) {
			return null;
		}

		try {
			switch (method) {
				case "initialize":
					return handleInitialize(id, params);

				case "ping":
					return successResponse(id, {});

				case "tools/list":
					return handleToolsList(id);

				case "tools/call":
					return await handleToolsCall(id, params ?? {}, context);

				case "resources/list":
					return handleResourcesList(id);

				case "resources/read":
					return await handleResourcesRead(id, params ?? {}, context);

				case "resources/templates/list":
					return handleResourcesTemplatesList(id);

				case "prompts/list":
					return handlePromptsList(id);

				case "prompts/get":
					return await handlePromptsGet(id, params ?? {}, context);

				default:
					throw MCPProtocolError.methodNotFound(method);
			}
		} catch (err) {
			if (err instanceof MCPProtocolError) {
				return errorResponse(id, err);
			}
			log.error(`Unhandled error in ${method}:`, err);
			return errorResponse(
				id,
				MCPProtocolError.internalError(err instanceof Error ? err.message : "Internal error"),
			);
		}
	}

	// ─── Method Handlers ────────────────────────────────────────

	function handleInitialize(
		id: string | number,
		params: Record<string, unknown> | undefined,
	): JsonRpcResponse {
		const capabilities: ServerCapabilities = {};

		if (tools.size > 0) {
			capabilities.tools = { listChanged: false };
		}
		if (resources.size > 0) {
			capabilities.resources = { subscribe: false, listChanged: false };
		}
		if (prompts.size > 0) {
			capabilities.prompts = { listChanged: false };
		}

		const result: InitializeResult = {
			protocolVersion: (params?.protocolVersion as string) ?? "2025-06-18",
			capabilities,
			serverInfo: { name: serverName, version: serverVersion },
		};

		if (instructions) {
			result.instructions = instructions;
		}

		return successResponse(id, result);
	}

	function handleToolsList(id: string | number): JsonRpcResponse {
		const toolList = tools.all().map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: schemaToJsonSchema(tool.input),
			annotations: Object.keys(tool.annotations).length > 0 ? tool.annotations : undefined,
		}));

		return successResponse(id, { tools: toolList });
	}

	async function handleToolsCall(
		id: string | number,
		params: Record<string, unknown>,
		context?: DispatchContext,
	): Promise<JsonRpcResponse> {
		const toolName = params.name as string;
		const args = (params.arguments ?? {}) as Record<string, unknown>;

		const tool = tools.get(toolName);
		if (!tool) {
			throw MCPProtocolError.invalidParams(`Tool not found: ${toolName}`);
		}

		// Validate input
		const validation = await validateInput(tool.input, args);
		if (!validation.ok) {
			const issues = validation.error.issues.map((i) => i.message).join("; ");
			return successResponse(id, {
				isError: true,
				content: [{ type: "text", text: `Validation error: ${issues}` }],
			});
		}

		// Execute with timeout
		const abortController = new AbortController();
		const env = context?.env ?? {};
		const ctx =
			context?.ctx ??
			({ waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext);
		const request = context?.request ?? new Request("https://localhost");

		try {
			const output = await executeWithTimeout(
				() =>
					Promise.resolve(tool.handler({
						input: validation.value,
						env,
						ctx,
						request,
						log,
						reportProgress: async () => {},
						signal: abortController.signal,
					})),
				tool.timeout,
				abortController.signal,
			);

			return successResponse(id, {
				content: [{ type: "text", text: JSON.stringify(output) }],
			});
		} catch (err) {
			return successResponse(id, toMCPToolError(err));
		}
	}

	function handleResourcesList(id: string | number): JsonRpcResponse {
		const resourceList = resources
			.all()
			.filter((r) => !r.isTemplate)
			.map((r) => ({
				uri: r.uri,
				name: r.uri,
				description: r.description,
				mimeType: r.mimeType,
			}));

		return successResponse(id, { resources: resourceList });
	}

	async function handleResourcesRead(
		id: string | number,
		params: Record<string, unknown>,
		context?: DispatchContext,
	): Promise<JsonRpcResponse> {
		const uri = params.uri as string;

		const match = resources.match(uri);
		if (!match) {
			throw MCPProtocolError.invalidParams(`Resource not found: ${uri}`);
		}

		const env = context?.env ?? {};
		const ctx =
			context?.ctx ??
			({ waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext);

		const result = await match.resource.handler({
			uri,
			params: match.params,
			env,
			ctx,
			log,
		});

		return successResponse(id, { contents: result.contents });
	}

	function handleResourcesTemplatesList(id: string | number): JsonRpcResponse {
		const templateList = resources.templates().map((r) => ({
			uriTemplate: r.uri,
			name: r.uri,
			description: r.description,
			mimeType: r.mimeType,
		}));

		return successResponse(id, { resourceTemplates: templateList });
	}

	function handlePromptsList(id: string | number): JsonRpcResponse {
		const promptList = prompts.all().map((p) => {
			const item: Record<string, unknown> = {
				name: p.name,
				description: p.description,
			};
			if (p.args) {
				const schema = schemaToJsonSchema(p.args);
				if (schema.properties) {
					item.arguments = Object.entries(
						schema.properties as Record<string, Record<string, unknown>>,
					).map(([name, prop]) => ({
						name,
						description: (prop as any).description,
						required: (schema.required as string[] | undefined)?.includes(name) ?? false,
					}));
				}
			}
			return item;
		});

		return successResponse(id, { prompts: promptList });
	}

	async function handlePromptsGet(
		id: string | number,
		params: Record<string, unknown>,
		context?: DispatchContext,
	): Promise<JsonRpcResponse> {
		const promptName = params.name as string;
		const args = (params.arguments ?? {}) as Record<string, unknown>;

		const prompt = prompts.get(promptName);
		if (!prompt) {
			throw MCPProtocolError.invalidParams(`Prompt not found: ${promptName}`);
		}

		// Validate args if schema exists
		if (prompt.args) {
			const validation = await validateInput(prompt.args, args);
			if (!validation.ok) {
				const issues = validation.error.issues.map((i) => i.message).join("; ");
				throw MCPProtocolError.invalidParams(`Invalid prompt arguments: ${issues}`);
			}
		}

		const env = context?.env ?? {};
		const ctx =
			context?.ctx ??
			({ waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext);

		const result = await prompt.handler({
			args: prompt.args ? ((await validateInput(prompt.args, args)) as { ok: true; value: unknown }).value : undefined,
			env,
			ctx,
			log,
		} as any);

		return successResponse(id, { messages: result.messages });
	}

	return { dispatch };
}
