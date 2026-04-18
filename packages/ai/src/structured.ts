import { BindingNotFoundError } from "@workkit/errors";
import { StructuredOutputError } from "./errors";
import { standardSchemaToJsonSchema } from "./schema";
import type { AiBinding } from "./types";

// ─── Standard Schema V1 types (inlined to avoid hard dep) ────

interface StandardSchemaV1Issue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

type StandardSchemaV1Result<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<StandardSchemaV1Issue>; readonly value?: undefined };

interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
	};
	readonly "~types"?: { readonly input: Input; readonly output: Output };
}

// ─── Public types ────────────────────────────────────────────

/** Options for structured (JSON mode) AI output */
export interface StructuredOptions<T> {
	/** Standard Schema v1 schema describing the expected output shape */
	schema: StandardSchemaV1<T>;
	/** Number of retries on parse/validation failure (default: 1) */
	maxRetries?: number;
}

/** Result from a structured AI call */
export interface StructuredResult<T> {
	/** The parsed and validated data */
	data: T;
	/** The raw string response from the model */
	raw: string;
	/** The model that produced the output */
	model: string;
}

// ─── Implementation ──────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 1;

/**
 * Run a text generation model and parse the response as structured JSON
 * validated against a Standard Schema.
 *
 * Adds `response_format: { type: "json_object" }` to the input (Workers AI format)
 * and prepends a system message instructing the model to output JSON matching the schema.
 *
 * On validation failure, retries up to `maxRetries` with the error context appended.
 * On final failure, throws a {@link StructuredOutputError}.
 *
 * @param binding - The AI binding from the worker environment (env.AI)
 * @param model - The text generation model identifier
 * @param input - Messages and other model parameters
 * @param structured - Schema and retry options
 * @returns The parsed data, raw response, and model name
 * @throws {StructuredOutputError} If the response does not match the schema after retries
 * @throws {BindingNotFoundError} If the binding is nullish
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { structuredAI } from "@workkit/ai";
 *
 * const result = await structuredAI(
 *   env.AI,
 *   "@cf/meta/llama-3.1-8b-instruct",
 *   { messages: [{ role: "user", content: "List 3 colors" }] },
 *   { schema: z.object({ colors: z.array(z.string()) }) },
 * );
 * // result.data.colors → ["red", "green", "blue"]
 * ```
 *
 * @deprecated Use `gateway.run(model, input, { responseFormat: { jsonSchema } })`
 * from `@workkit/ai-gateway` — normalizes JSON mode across Workers AI, OpenAI,
 * and Anthropic. See ADR-001; tracked in #63.
 */
export async function structuredAI<T>(
	binding: AiBinding,
	model: string,
	input: { messages: Array<{ role: string; content: string }>; [key: string]: unknown },
	structured: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
	if (!binding) {
		throw new BindingNotFoundError("AI");
	}

	const maxRetries = structured.maxRetries ?? DEFAULT_MAX_RETRIES;
	const jsonSchema = standardSchemaToJsonSchema(structured.schema as any);

	// Build the system instruction for JSON output
	const schemaInstruction = buildSchemaInstruction(jsonSchema);

	// Clone messages so we don't mutate the caller's array
	const messages: Array<{ role: string; content: string }> = [
		{ role: "system", content: schemaInstruction },
		...input.messages,
	];

	// Build input with response_format for Workers AI JSON mode
	const { messages: _discardMessages, ...restInput } = input;

	let lastRaw = "";
	let lastIssues: unknown[] = [];

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const runInput: Record<string, unknown> = {
			...restInput,
			messages,
			response_format: { type: "json_object" },
		};

		const response = await binding.run(model, runInput);

		// Extract text from response
		const rawText = extractResponseText(response);
		lastRaw = rawText;

		// Try to parse as JSON
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch {
			const parseIssues = [{ message: `Invalid JSON: ${rawText.slice(0, 200)}` }];
			lastIssues = parseIssues;

			if (attempt < maxRetries) {
				messages.push({
					role: "assistant",
					content: rawText,
				});
				messages.push({
					role: "user",
					content:
						"Your response was not valid JSON. Please respond with valid JSON matching the schema.",
				});
				continue;
			}

			throw new StructuredOutputError(rawText, parseIssues);
		}

		// Validate against the Standard Schema
		const result = await structured.schema["~standard"].validate(parsed);

		if (result.issues) {
			lastIssues = [...result.issues];

			if (attempt < maxRetries) {
				const issuesSummary = result.issues
					.map((issue) => {
						const path = issue.path
							? issue.path
									.map((p) =>
										typeof p === "object" && p !== null && "key" in p ? String(p.key) : String(p),
									)
									.join(".")
							: "";
						return path ? `${path}: ${issue.message}` : issue.message;
					})
					.join("; ");

				messages.push({
					role: "assistant",
					content: rawText,
				});
				messages.push({
					role: "user",
					content: `Your JSON response had validation errors: ${issuesSummary}. Please fix and respond with valid JSON matching the schema.`,
				});
				continue;
			}

			throw new StructuredOutputError(rawText, lastIssues);
		}

		return {
			data: result.value as T,
			raw: rawText,
			model,
		};
	}

	// Should not be reachable, but just in case
	throw new StructuredOutputError(lastRaw, lastIssues);
}

// ─── Helpers ─────────────────────────────────────────────────

function buildSchemaInstruction(jsonSchema: Record<string, unknown>): string {
	return [
		"You must respond with valid JSON only, no other text.",
		"Your response must conform to this JSON Schema:",
		JSON.stringify(jsonSchema),
	].join("\n");
}

function extractResponseText(response: unknown): string {
	if (typeof response === "string") {
		return response;
	}
	if (response != null && typeof response === "object") {
		const obj = response as Record<string, unknown>;
		if (typeof obj.response === "string") return obj.response;
		if (typeof obj.text === "string") return obj.text;
		// If it's already an object, stringify it
		return JSON.stringify(response);
	}
	return String(response);
}
