import { parsePath, toOpenAPIPath } from "./path";
import type { ApiDefinition, OpenAPIConfig, StandardSchemaV1 } from "./types";

/**
 * Generate an OpenAPI 3.1 specification from API definitions.
 *
 * @example
 * ```ts
 * const spec = generateOpenAPI({
 *   title: 'My API',
 *   version: '1.0.0',
 *   apis: [getUser, createUser],
 * })
 * ```
 */
export function generateOpenAPI(config: OpenAPIConfig): Record<string, unknown> {
	const { title, version, description, servers, apis } = config;

	const paths: Record<string, Record<string, unknown>> = {};

	for (const api of apis) {
		const openApiPath = toOpenAPIPath(api.path);
		const method = api.method.toLowerCase();

		if (!paths[openApiPath]) {
			paths[openApiPath] = {};
		}

		const operation: Record<string, unknown> = {
			operationId: generateOperationId(api),
			responses: {
				"200": {
					description: "Successful response",
					content: api.response
						? {
								"application/json": {
									schema: schemaToJsonSchema(api.response),
								},
							}
						: undefined,
				},
			},
		};

		// Path parameters
		const parsed = parsePath(api.path);
		if (parsed.params.length > 0) {
			const parameters: unknown[] = operation.parameters ? (operation.parameters as unknown[]) : [];

			for (const param of parsed.params) {
				parameters.push({
					name: param,
					in: "path",
					required: true,
					schema: { type: "string" },
				});
			}

			operation.parameters = parameters;
		}

		// Query parameters
		if (api.query) {
			const parameters: unknown[] = operation.parameters ? (operation.parameters as unknown[]) : [];

			const querySchema = schemaToJsonSchema(api.query);
			if (querySchema && typeof querySchema === "object" && "properties" in querySchema) {
				const props = (querySchema as any).properties as Record<string, unknown>;
				const required = (querySchema as any).required as string[] | undefined;

				for (const [name, propSchema] of Object.entries(props)) {
					parameters.push({
						name,
						in: "query",
						required: required?.includes(name) ?? false,
						schema: propSchema,
					});
				}
			}

			operation.parameters = parameters;
		}

		// Request body
		if (api.body) {
			operation.requestBody = {
				required: true,
				content: {
					"application/json": {
						schema: schemaToJsonSchema(api.body),
					},
				},
			};
		}

		// Error responses
		if (api.body || api.params || api.query) {
			(operation.responses as any)["400"] = {
				description: "Validation error",
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: {
								error: {
									type: "object",
									properties: {
										code: { type: "string" },
										message: { type: "string" },
										issues: {
											type: "array",
											items: {
												type: "object",
												properties: {
													path: { type: "array", items: { type: "string" } },
													message: { type: "string" },
												},
											},
										},
									},
								},
							},
						},
					},
				},
			};
		}
		(operation.responses as any)["500"] = {
			description: "Internal server error",
		};

		paths[openApiPath][method] = operation;
	}

	const spec: Record<string, unknown> = {
		openapi: "3.1.0",
		info: {
			title,
			version,
			...(description ? { description } : {}),
		},
		paths,
	};

	if (servers && servers.length > 0) {
		spec.servers = servers;
	}

	return spec;
}

/**
 * Generate an operation ID from an API definition.
 * Uses method + path segments, e.g., GET /users/:id → getUsers_id
 */
function generateOperationId(api: ApiDefinition): string {
	const method = api.method.toLowerCase();
	const segments = parsePath(api.path)
		.segments.map((s) => {
			if (s.startsWith(":")) return s.slice(1);
			return s;
		})
		.map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)));

	return method + segments.map((s, i) => (i === 0 ? capitalize(s) : s)).join("");
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Attempt to extract a JSON Schema from a Standard Schema.
 * Falls back to a generic object schema if introspection isn't available.
 */
function schemaToJsonSchema(schema: StandardSchemaV1): Record<string, unknown> {
	// Many Standard Schema implementations expose a .jsonSchema or toJsonSchema()
	const s = schema as any;

	if (typeof s.toJsonSchema === "function") {
		return s.toJsonSchema();
	}

	// Zod's internal shape — attempt to generate a minimal schema
	if (s._def?.typeName) {
		return zodDefToJsonSchema(s._def);
	}

	// Fallback
	return { type: "object" };
}

/** Best-effort Zod definition to JSON Schema conversion */
function zodDefToJsonSchema(def: any): Record<string, unknown> {
	switch (def.typeName) {
		case "ZodString":
			return { type: "string" };
		case "ZodNumber":
			return { type: "number" };
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodArray":
			return {
				type: "array",
				items: def.type?._def ? zodDefToJsonSchema(def.type._def) : {},
			};
		case "ZodObject": {
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			if (def.shape) {
				const shape = typeof def.shape === "function" ? def.shape() : def.shape;
				for (const [key, value] of Object.entries(shape)) {
					const v = value as any;
					if (v?._def) {
						properties[key] = zodDefToJsonSchema(v._def);
						// Check if field is optional
						if (v._def.typeName !== "ZodOptional") {
							required.push(key);
						}
					}
				}
			}

			const result: Record<string, unknown> = { type: "object", properties };
			if (required.length > 0) result.required = required;
			return result;
		}
		case "ZodOptional":
			return def.innerType?._def ? zodDefToJsonSchema(def.innerType._def) : {};
		case "ZodEnum":
			return { type: "string", enum: def.values };
		case "ZodLiteral":
			return { type: typeof def.value, const: def.value };
		default:
			return {};
	}
}
