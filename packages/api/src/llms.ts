import { api } from "./define";
import type { ApiDefinition, LlmsGenerationOptions, LlmsGroupBy, LlmsRoutesConfig } from "./types";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

interface ParsedOperation {
	method: string;
	path: string;
	summary: string;
	description: string;
	group: string;
	tags: string[];
	operation: Record<string, unknown>;
}

/**
 * Generate llms.txt (short index) from an OpenAPI specification.
 */
export function generateLlmsTxt(
	openapiSpec: Record<string, unknown>,
	options: LlmsGenerationOptions = {},
): string {
	const info = readInfo(openapiSpec);
	const operations = collectOperations(openapiSpec, options);
	const groupBy = options.groupBy ?? "tag";
	const grouped = groupOperations(operations, groupBy);
	const lines: string[] = [];

	lines.push(`# ${info.title}`);
	lines.push("");

	if (options.siteBlurb) {
		lines.push(options.siteBlurb);
		lines.push("");
	} else if (info.description) {
		lines.push(info.description);
		lines.push("");
	}

	lines.push("## API Endpoint Index");
	lines.push("");

	for (const [group, ops] of grouped) {
		if (groupBy !== "none") {
			lines.push(`### ${group}`);
		}
		for (const operation of ops) {
			lines.push(`- ${operation.method} ${operation.path} — ${operation.summary}`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

/**
 * Generate llms-full.txt (full endpoint corpus) from an OpenAPI specification.
 */
export function generateLlmsFullTxt(
	openapiSpec: Record<string, unknown>,
	options: LlmsGenerationOptions = {},
): string {
	const info = readInfo(openapiSpec);
	const operations = collectOperations(openapiSpec, options);
	const groupBy = options.groupBy ?? "tag";
	const grouped = groupOperations(operations, groupBy);
	const lines: string[] = [];
	const inlineSchemas = options.inlineSchemas ?? true;

	lines.push(`# ${info.title} — Full API Reference`);
	lines.push("");

	if (options.siteBlurb) {
		lines.push(options.siteBlurb);
		lines.push("");
	} else if (info.description) {
		lines.push(info.description);
		lines.push("");
	}

	for (const [group, ops] of grouped) {
		if (groupBy !== "none") {
			lines.push(`## ${group}`);
			lines.push("");
		}

		for (const operation of ops) {
			const operationData = operation.operation;
			lines.push(`### ${operation.method} ${operation.path}`);
			lines.push(`Summary: ${operation.summary}`);
			if (operation.description) {
				lines.push(`Description: ${operation.description}`);
			}

			if (operation.tags.length > 0) {
				lines.push(`Tags: ${operation.tags.join(", ")}`);
			}

			lines.push(`Auth: ${describeAuth(openapiSpec, operationData)}`);
			lines.push("");

			const parameters = asArray(operationData.parameters);
			lines.push("Parameters:");
			if (parameters.length === 0) {
				lines.push("- none");
			} else {
				for (const parameter of parameters) {
					const param = asObject(parameter);
					const location = asString(param.in) || "unknown";
					const name = asString(param.name) || "unknown";
					const required = Boolean(param.required);
					const schemaText = formatSchema(
						asObject(param.schema),
						inlineSchemas,
						options.schemaRefBaseUrl,
					);
					lines.push(`- ${location}.${name} (${required ? "required" : "optional"}): ${schemaText}`);
				}
			}
			lines.push("");

			lines.push("Request Body:");
			const requestBody = asObject(operationData.requestBody);
			const bodyContent = asObject(requestBody.content);
			const bodyMediaTypes = Object.entries(bodyContent);
			if (bodyMediaTypes.length === 0) {
				lines.push("- none");
			} else {
				for (const [mediaType, mediaObject] of bodyMediaTypes) {
					const media = asObject(mediaObject);
					const schemaText = formatSchema(
						asObject(media.schema),
						inlineSchemas,
						options.schemaRefBaseUrl,
					);
					lines.push(`- ${mediaType}: ${schemaText}`);
				}
			}
			lines.push("");

			lines.push("Responses:");
			const responses = asObject(operationData.responses);
			const responseEntries = Object.entries(responses);
			if (responseEntries.length === 0) {
				lines.push("- none");
			} else {
				for (const [status, responseValue] of responseEntries) {
					const response = asObject(responseValue);
					const description = asString(response.description) || "No description";
					lines.push(`- ${status}: ${description}`);
					const content = asObject(response.content);
					for (const [mediaType, mediaObject] of Object.entries(content)) {
						const media = asObject(mediaObject);
						const schemaText = formatSchema(
							asObject(media.schema),
							inlineSchemas,
							options.schemaRefBaseUrl,
						);
						lines.push(`  - ${mediaType}: ${schemaText}`);
					}
				}
			}
			lines.push("");
		}
	}

	return lines.join("\n").trimEnd();
}

/**
 * Create API route definitions for serving /llms.txt and /llms-full.txt.
 */
export function createLlmsRoutes<TEnv = unknown>(
	config: LlmsRoutesConfig,
): [ApiDefinition<"GET", string, undefined, undefined, undefined, undefined, TEnv>, ApiDefinition<"GET", string, undefined, undefined, undefined, undefined, TEnv>] {
	const llmsPath = config.llmsPath ?? "/llms.txt";
	const llmsFullPath = config.llmsFullPath ?? "/llms-full.txt";

	const llms = api({
		method: "GET",
		path: llmsPath,
		handler: async () => {
			const openapiSpec = await resolveSpec(config.openapiSpec);
			const content = generateLlmsTxt(openapiSpec, config.llmsOptions);
			return new Response(content, {
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		},
	});

	const llmsFull = api({
		method: "GET",
		path: llmsFullPath,
		handler: async () => {
			const openapiSpec = await resolveSpec(config.openapiSpec);
			const content = generateLlmsFullTxt(openapiSpec, config.llmsFullOptions);
			return new Response(content, {
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		},
	});

	return [llms, llmsFull];
}

function readInfo(openapiSpec: Record<string, unknown>): { title: string; description: string } {
	const info = asObject(openapiSpec.info);
	const title = asString(info.title) || "API";
	const description = asString(info.description) || "";
	return { title, description };
}

function collectOperations(
	openapiSpec: Record<string, unknown>,
	options: LlmsGenerationOptions,
): ParsedOperation[] {
	const paths = asObject(openapiSpec.paths);
	const operations: ParsedOperation[] = [];

	for (const [path, pathItem] of Object.entries(paths)) {
		if (!shouldIncludePath(path, options)) continue;
		const pathObject = asObject(pathItem);

		for (const [method, operationValue] of Object.entries(pathObject)) {
			if (!HTTP_METHODS.has(method.toLowerCase())) continue;
			const operation = asObject(operationValue);
			const summary = asString(operation.summary) || asString(operation.operationId) || "No summary";
			const description = asString(operation.description) || "";
			const tags = asStringArray(operation.tags);

			operations.push({
				method: method.toUpperCase(),
				path,
				summary,
				description,
				group: pickGroup(tags, path, options.groupBy ?? "tag"),
				tags,
				operation,
			});
		}
	}

	return operations.sort((a, b) => {
		if (a.group !== b.group) return a.group.localeCompare(b.group);
		if (a.path !== b.path) return a.path.localeCompare(b.path);
		return a.method.localeCompare(b.method);
	});
}

function groupOperations(
	operations: ParsedOperation[],
	groupBy: LlmsGroupBy,
): Array<[string, ParsedOperation[]]> {
	if (groupBy === "none") {
		return [["Endpoints", operations]];
	}

	const groups = new Map<string, ParsedOperation[]>();
	for (const operation of operations) {
		const groupName = operation.group || "General";
		const current = groups.get(groupName) ?? [];
		current.push(operation);
		groups.set(groupName, current);
	}

	return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function pickGroup(tags: string[], path: string, groupBy: LlmsGroupBy): string {
	if (groupBy === "resource") {
		return resourceFromPath(path);
	}
	if (groupBy === "none") {
		return "Endpoints";
	}
	if (tags.length > 0) {
		return tags[0] ?? "General";
	}
	return resourceFromPath(path);
}

function resourceFromPath(path: string): string {
	const segment = path
		.split("/")
		.filter(Boolean)
		.find((part) => !part.startsWith("{"));
	return segment ?? "root";
}

function shouldIncludePath(path: string, options: LlmsGenerationOptions): boolean {
	if (options.includePaths && options.includePaths.length > 0) {
		const matchesInclude = options.includePaths.some((pattern) => globMatches(path, pattern));
		if (!matchesInclude) return false;
	}

	if (options.excludePaths && options.excludePaths.length > 0) {
		const matchesExclude = options.excludePaths.some((pattern) => globMatches(path, pattern));
		if (matchesExclude) return false;
	}

	return true;
}

function globMatches(value: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "__DOUBLE_WILDCARD__")
		.replace(/\*/g, "[^/]*")
		.replace(/__DOUBLE_WILDCARD__/g, ".*");
	const regex = new RegExp(`^${escaped}$`);
	return regex.test(value);
}

function describeAuth(openapiSpec: Record<string, unknown>, operation: Record<string, unknown>): string {
	const operationSecurity = asArray(operation.security);
	const rootSecurity = asArray(asObject(openapiSpec).security);
	const activeSecurity = operationSecurity.length > 0 ? operationSecurity : rootSecurity;

	if (activeSecurity.length === 0) {
		return "none";
	}

	const schemes: string[] = [];
	for (const requirement of activeSecurity) {
		for (const schemeName of Object.keys(asObject(requirement))) {
			schemes.push(schemeName);
		}
	}

	if (schemes.length === 0) {
		return "required";
	}

	return [...new Set(schemes)].join(", ");
}

function formatSchema(
	schema: Record<string, unknown>,
	inlineSchemas: boolean,
	schemaRefBaseUrl?: string,
): string {
	if (Object.keys(schema).length === 0) return "{}";

	if (!inlineSchemas) {
		const ref = asString(schema.$ref);
		if (ref && schemaRefBaseUrl) {
			return `${schemaRefBaseUrl}${ref.replace(/^#\//, "")}`;
		}
		if (ref) return ref;
		return "see OpenAPI schema";
	}

	return JSON.stringify(schema);
}

async function resolveSpec(source: LlmsRoutesConfig["openapiSpec"]): Promise<Record<string, unknown>> {
	if (typeof source === "function") {
		return source();
	}
	return source;
}

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}
