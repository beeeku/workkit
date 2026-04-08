// src/openapi.ts
import type { ToolRegistry } from "./registry";
import { schemaToJsonSchema } from "./validation";

// ─── Types ────────────────────────────────────────────────────

export interface OpenAPIServer {
	url: string;
	description?: string;
}

export interface GenerateOpenAPISpecConfig {
	serverName: string;
	serverVersion: string;
	description?: string;
	basePath: string;
	tools: ToolRegistry<any>;
	servers?: OpenAPIServer[];
}

export interface OpenAPISpec {
	openapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
	};
	servers?: OpenAPIServer[];
	paths: Record<string, PathItem>;
	components: {
		responses: Record<string, ResponseObject>;
	};
}

interface PathItem {
	post: OperationObject;
}

interface OperationObject {
	operationId: string;
	summary: string;
	tags: string[];
	requestBody: RequestBodyObject;
	responses: Record<string, ResponseObject>;
}

interface RequestBodyObject {
	required: boolean;
	content: {
		"application/json": {
			schema: Record<string, unknown>;
		};
	};
}

interface ResponseObject {
	description: string;
	content?: {
		"application/json": {
			schema: Record<string, unknown>;
		};
	};
}

// ─── Shared Error Schemas ─────────────────────────────────────

const VALIDATION_ERROR_SCHEMA = {
	type: "object",
	properties: {
		error: {
			type: "object",
			properties: {
				code: { type: "string", example: "VALIDATION_ERROR" },
				message: { type: "string" },
				issues: {
					type: "array",
					items: {
						type: "object",
						properties: {
							message: { type: "string" },
							path: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
			required: ["code", "message"],
		},
	},
	required: ["error"],
};

const INTERNAL_ERROR_SCHEMA = {
	type: "object",
	properties: {
		error: {
			type: "object",
			properties: {
				code: { type: "string", example: "INTERNAL_ERROR" },
				message: { type: "string" },
			},
			required: ["code", "message"],
		},
	},
	required: ["error"],
};

// ─── generateOpenAPISpec ──────────────────────────────────────

/**
 * Generate a complete OpenAPI 3.1.0 spec from a ToolRegistry.
 *
 * Each tool becomes a POST endpoint at `{basePath}/tools/{toolName}`.
 * Input schemas are converted from Standard Schema (Zod) to JSON Schema.
 * Output schemas (if defined) are wrapped as `{ result: outputSchema }`.
 */
export function generateOpenAPISpec(config: GenerateOpenAPISpecConfig): OpenAPISpec {
	const { serverName, serverVersion, description, basePath, tools, servers } = config;

	const paths: Record<string, PathItem> = {};

	for (const tool of tools.all()) {
		const path = `${basePath}/tools/${tool.name}`;

		// Convert input schema to JSON Schema
		const inputSchema = tool.input
			? schemaToJsonSchema(tool.input)
			: { type: "object", properties: {} };

		// Build response schema
		let responseSchema: Record<string, unknown>;
		if (tool.output) {
			const outputSchema = schemaToJsonSchema(tool.output);
			responseSchema = {
				type: "object",
				properties: {
					result: outputSchema,
				},
			};
		} else {
			responseSchema = {
				type: "object",
				properties: {
					result: {},
				},
			};
		}

		const operation: OperationObject = {
			operationId: `tool_${tool.name}`,
			summary: tool.description,
			tags: tool.tags && tool.tags.length > 0 ? tool.tags : ["tools"],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: inputSchema,
					},
				},
			},
			responses: {
				"200": {
					description: "Successful response",
					content: {
						"application/json": {
							schema: responseSchema,
						},
					},
				},
				"400": {
					description: "Validation error",
					content: {
						"application/json": {
							schema: VALIDATION_ERROR_SCHEMA,
						},
					},
				},
				"500": {
					description: "Internal server error",
					content: {
						"application/json": {
							schema: INTERNAL_ERROR_SCHEMA,
						},
					},
				},
			},
		};

		paths[path] = { post: operation };
	}

	const spec: OpenAPISpec = {
		openapi: "3.1.0",
		info: {
			title: serverName,
			version: serverVersion,
			...(description ? { description } : {}),
		},
		paths,
		components: {
			responses: {
				ValidationError: {
					description: "Validation error — request body did not match the tool's input schema",
					content: {
						"application/json": {
							schema: VALIDATION_ERROR_SCHEMA,
						},
					},
				},
				InternalError: {
					description: "Internal server error — tool handler threw an unexpected error",
					content: {
						"application/json": {
							schema: INTERNAL_ERROR_SCHEMA,
						},
					},
				},
			},
		},
	};

	if (servers && servers.length > 0) {
		spec.servers = servers;
	}

	return spec;
}
