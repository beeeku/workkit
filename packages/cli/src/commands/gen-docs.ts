import type { FileSystem } from "../utils";
import type { RouteDefinition } from "./gen-client";
import { extractRoutes } from "./gen-client";

export interface OpenAPISpec {
	openapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
	};
	paths: Record<string, Record<string, OpenAPIOperation>>;
}

export interface OpenAPIOperation {
	operationId: string;
	summary: string;
	responses: Record<string, { description: string; content?: Record<string, unknown> }>;
	requestBody?: {
		content: Record<string, unknown>;
	};
}

export interface GenDocsOptions {
	sourceDir: string;
	output: string;
	title?: string;
	version?: string;
}

/**
 * Convert route definitions to OpenAPI 3.1 spec.
 */
export function routesToOpenAPI(
	routes: RouteDefinition[],
	title: string,
	version: string,
): OpenAPISpec {
	const paths: Record<string, Record<string, OpenAPIOperation>> = {};

	for (const route of routes) {
		const method = route.method.toLowerCase();

		// Convert :param to {param} for OpenAPI
		const openApiPath = route.path.replace(/:(\w+)/g, "{$1}");

		if (!paths[openApiPath]) {
			paths[openApiPath] = {};
		}

		const operation: OpenAPIOperation = {
			operationId: route.name,
			summary: `${route.method} ${route.path}`,
			responses: {
				"200": {
					description: "Successful response",
					content: {
						"application/json": {
							schema: { type: "object" },
						},
					},
				},
			},
		};

		if (["POST", "PUT", "PATCH"].includes(route.method)) {
			operation.requestBody = {
				content: {
					"application/json": {
						schema: { type: "object" },
					},
				},
			};
		}

		paths[openApiPath]![method] = operation;
	}

	return {
		openapi: "3.1.0",
		info: {
			title,
			version,
		},
		paths,
	};
}

/**
 * Generate OpenAPI path parameters from route path.
 */
export function extractPathParams(path: string): string[] {
	const params: string[] = [];
	const regex = /:(\w+)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(path)) !== null) {
		params.push(match[1]!);
	}
	return params;
}

/**
 * Execute the gen docs command.
 */
export async function executeGenDocs(
	options: GenDocsOptions,
	fs: FileSystem,
): Promise<OpenAPISpec> {
	if (!(await fs.exists(options.sourceDir))) {
		throw new Error(`Source directory not found: ${options.sourceDir}`);
	}

	const entries = await fs.readDir(options.sourceDir);
	const tsFiles = entries.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

	const allRoutes: RouteDefinition[] = [];

	for (const file of tsFiles) {
		const content = await fs.readFile(`${options.sourceDir}/${file}`);
		const routes = extractRoutes(content, file);
		allRoutes.push(...routes);
	}

	const title = options.title ?? "API";
	const version = options.version ?? "0.0.1";

	const spec = routesToOpenAPI(allRoutes, title, version);
	await fs.writeFile(options.output, `${JSON.stringify(spec, null, 2)}\n`);

	return spec;
}
