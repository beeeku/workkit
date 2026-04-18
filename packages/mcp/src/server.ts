// src/server.ts
import { Hono } from "hono";
import { generateOpenAPISpec } from "./openapi";
import { createProtocolHandler } from "./protocol";
import { createPromptRegistry, createResourceRegistry, createToolRegistry } from "./registry";
import { createRestHandler } from "./rest";
import { createTransportHandler } from "./transport";
import type {
	MCPServer,
	MCPServerConfig,
	PromptConfig,
	RegisteredPrompt,
	RegisteredResource,
	RegisteredTool,
	ResourceConfig,
	StandardSchemaV1,
	ToolConfig,
	WorkerModule,
} from "./types";

// ─── createMCPServer ─────────────────────────────────────────

export function createMCPServer<
	TEnv extends Record<string, unknown> | undefined = Record<string, unknown>,
>(config: MCPServerConfig<TEnv>): MCPServer<TEnv> {
	const toolRegistry = createToolRegistry<TEnv>();
	const resourceRegistry = createResourceRegistry<TEnv>();
	const promptRegistry = createPromptRegistry<TEnv>();

	let sealed = false;
	let cachedOpenAPISpec: Record<string, unknown> | null = null;
	let honoApp: Hono<{ Bindings: TEnv }> | null = null;

	function ensureNotSealed(): void {
		if (sealed) {
			throw new Error("Server is sealed — no more registrations after serve() or mount()");
		}
	}

	function freezeAll(): void {
		if (sealed) return;
		sealed = true;
		toolRegistry.freeze();
		resourceRegistry.freeze();
		promptRegistry.freeze();
	}

	function getOpenAPISpec(): Record<string, unknown> {
		if (cachedOpenAPISpec) return cachedOpenAPISpec;

		const basePath = config.basePath ?? "/api";
		cachedOpenAPISpec = generateOpenAPISpec({
			serverName: config.name,
			serverVersion: config.version,
			description: config.description,
			basePath,
			tools: toolRegistry as any,
			servers: config.openapi?.servers,
		}) as unknown as Record<string, unknown>;

		return cachedOpenAPISpec;
	}

	function buildHonoApp(): Hono<{ Bindings: TEnv }> {
		if (honoApp) return honoApp;

		const mcpPath = config.mcpPath ?? "/mcp";
		const basePath = config.basePath ?? "/api";

		const protocol = createProtocolHandler({
			serverName: config.name,
			serverVersion: config.version,
			instructions: config.instructions,
			tools: toolRegistry as any,
			resources: resourceRegistry as any,
			prompts: promptRegistry as any,
		});

		const transport = createTransportHandler({
			protocol,
			maxBatchSize: config.maxBatchSize,
		});

		const rest = createRestHandler<TEnv>({
			tools: toolRegistry as any,
			basePath,
			middleware: config.middleware,
		});

		const app = new Hono<{ Bindings: TEnv }>();

		// Authentication middleware — config.auth.handler is invoked for every request whose
		// path is not in config.auth.exclude. The handler is a Middleware<TEnv> that may either
		// return a Response (rejecting the request) or call next() to continue.
		if (config.auth?.handler) {
			const authHandler = config.auth.handler;
			const exclude = new Set(config.auth.exclude ?? []);
			app.use("*", async (c, next) => {
				const path = new URL(c.req.url).pathname;
				if (exclude.has(path)) return next();
				const result = await authHandler(c.req.raw, c.env as any, async () => {
					await next();
					return c.res;
				});
				return result;
			});
		}

		// MCP transport endpoint
		app.post(mcpPath, async (c) => {
			const env = c.env;
			const ctx = (c as any).executionCtx ?? {
				waitUntil: () => {},
				passThroughOnException: () => {},
			};
			return transport.handleRequest(c.req.raw, env, ctx);
		});

		// REST endpoints
		app.post(`${basePath}/tools/:toolName`, async (c) => {
			const env = c.env;
			const ctx = (c as any).executionCtx ?? {
				waitUntil: () => {},
				passThroughOnException: () => {},
			};
			const response = await rest.handleRequest(c.req.raw, env as TEnv, ctx);
			return response ?? c.notFound();
		});

		// OpenAPI spec
		if (config.openapi?.enabled !== false) {
			app.get("/openapi.json", (c) => {
				return c.json(getOpenAPISpec());
			});

			// Swagger UI: serve a small HTML shell that loads swagger-ui-dist from the CDN
			// and points it at /openapi.json. Opt-in via openapi.swaggerUI: true | { cdn?: boolean }.
			const swaggerOpt = config.openapi?.swaggerUI;
			if (swaggerOpt) {
				const cdn =
					typeof swaggerOpt === "object" && swaggerOpt.cdn === false
						? null
						: "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5";
				if (cdn) {
					app.get("/docs", (c) => {
						const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${config.name} — API docs</title>
<link rel="stylesheet" href="${cdn}/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="${cdn}/swagger-ui-bundle.js"></script>
<script>
window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: "/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
  });
};
</script>
</body>
</html>`;
						return c.html(html);
					});
				}
			}
		}

		// Health endpoint
		if (config.health !== false) {
			app.get("/health", (c) => {
				return c.json({ status: "ok" });
			});
		}

		honoApp = app;
		return app;
	}

	const server: MCPServer<TEnv> = {
		tool<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1 | undefined>(
			name: string,
			toolConfig: ToolConfig<TInput, TOutput, TEnv>,
		): MCPServer<TEnv> {
			ensureNotSealed();
			toolRegistry.register(name, toolConfig);
			return server;
		},

		resource(uri: string, resourceConfig: ResourceConfig<TEnv>): MCPServer<TEnv> {
			ensureNotSealed();
			resourceRegistry.register(uri, resourceConfig);
			return server;
		},

		prompt<TArgs extends StandardSchemaV1 | undefined>(
			name: string,
			promptConfig: PromptConfig<TArgs, TEnv>,
		): MCPServer<TEnv> {
			ensureNotSealed();
			promptRegistry.register(name, promptConfig);
			return server;
		},

		serve(): WorkerModule<TEnv> {
			if (toolRegistry.size === 0) {
				console.warn(
					"[workkit/mcp] Server has no tools registered — clients won't discover any capabilities",
				);
			}

			freezeAll();
			const app = buildHonoApp();

			return {
				fetch: app.fetch.bind(app) as WorkerModule<TEnv>["fetch"],
			};
		},

		mount() {
			freezeAll();

			const protocol = createProtocolHandler({
				serverName: config.name,
				serverVersion: config.version,
				instructions: config.instructions,
				tools: toolRegistry as any,
				resources: resourceRegistry as any,
				prompts: promptRegistry as any,
			});

			const transport = createTransportHandler({
				protocol,
				maxBatchSize: config.maxBatchSize,
			});

			const basePath = config.basePath ?? "/api";
			const rest = createRestHandler<TEnv>({
				tools: toolRegistry as any,
				basePath,
				middleware: config.middleware,
			});

			return {
				mcpHandler: async (request: Request, env: TEnv): Promise<Response> => {
					const ctx = {
						waitUntil: () => {},
						passThroughOnException: () => {},
					} as unknown as ExecutionContext;
					return transport.handleRequest(request, env, ctx);
				},
				restHandler: async (request: Request, env: TEnv): Promise<Response> => {
					const ctx = {
						waitUntil: () => {},
						passThroughOnException: () => {},
					} as unknown as ExecutionContext;
					const response = await rest.handleRequest(request, env, ctx);
					return response ?? new Response("Not Found", { status: 404 });
				},
				openapi: () => getOpenAPISpec(),
			};
		},

		toHono(): import("hono").Hono {
			if (!sealed) {
				if (toolRegistry.size === 0) {
					console.warn(
						"[workkit/mcp] Server has no tools registered — clients won't discover any capabilities",
					);
				}
				freezeAll();
			}
			return buildHonoApp() as unknown as import("hono").Hono;
		},

		get tools(): ReadonlyMap<string, RegisteredTool<TEnv>> {
			const map = new Map<string, RegisteredTool<TEnv>>();
			for (const tool of toolRegistry.all()) {
				map.set(tool.name, tool);
			}
			return map;
		},

		get resources(): ReadonlyMap<string, RegisteredResource<TEnv>> {
			const map = new Map<string, RegisteredResource<TEnv>>();
			for (const resource of resourceRegistry.all()) {
				map.set(resource.uri, resource);
			}
			return map;
		},

		get prompts(): ReadonlyMap<string, RegisteredPrompt<TEnv>> {
			const map = new Map<string, RegisteredPrompt<TEnv>>();
			for (const prompt of promptRegistry.all()) {
				map.set(prompt.name, prompt);
			}
			return map;
		},
	};

	return server;
}
