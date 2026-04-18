import { ConfigError, ValidationError } from "@workkit/errors";
import { standardSchemaToJsonSchema } from "./schema";
import type { AiInput, ChatMessage, Gateway } from "./types";

// ─── Standard Schema V1 types (inlined to avoid a hard dep) ────

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

// ─── Errors ─────────────────────────────────────────────────

/**
 * Error thrown when a structured output response does not match the expected
 * schema after all retry attempts have been exhausted.
 */
export class StructuredOutputError extends Error {
	readonly raw: string;
	readonly issues: unknown[];

	constructor(raw: string, issues: unknown[], message?: string) {
		super(message ?? "Response did not match expected schema");
		this.name = "StructuredOutputError";
		this.raw = raw;
		this.issues = issues;
	}
}

// ─── Public API ─────────────────────────────────────────────

/** Options for structured (JSON-mode + schema-validated) output. */
export interface StructuredOptions<T> {
	/** Standard Schema v1 schema describing the expected output shape. */
	schema: StandardSchemaV1<T>;
	/** Number of retries on parse/validation failure (default: 1). */
	maxRetries?: number;
}

/** Result from a structured gateway call. */
export interface StructuredResult<T> {
	/** The parsed, validated data. */
	data: T;
	/** Raw string response from the model. */
	raw: string;
	/** Provider that handled the request. */
	provider: string;
	/** Model that produced the output. */
	model: string;
}

const DEFAULT_MAX_RETRIES = 1;

/**
 * Run a gateway model and parse the response as structured JSON validated
 * against a Standard Schema. On failure, retries up to `maxRetries` with the
 * validation errors included in the conversation so the model can self-correct.
 * Throws {@link StructuredOutputError} if all attempts fail.
 *
 * Passes `responseFormat: { jsonSchema }` to the gateway call. Only OpenAI
 * enforces the schema natively today (via `response_format: { type: "json_schema" }`).
 * Workers AI (`{ type: "json_object" }`) and Anthropic (instruction-based) both
 * use prompt-level hints, so the validation + retry loop here does the real
 * work — invalid responses are fed back to the model with the validation
 * errors inlined for self-correction.
 *
 * @example
 * ```ts
 * const result = await structuredAI(gateway, "claude-sonnet-4-6",
 *   { messages: [{ role: "user", content: "List 3 colors" }] },
 *   { schema: z.object({ colors: z.array(z.string()) }) },
 * );
 * // result.data.colors → ["red", "green", "blue"]
 * ```
 */
export async function structuredAI<T>(
	gateway: Gateway,
	model: string,
	input: AiInput,
	structured: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
	if (!gateway) {
		throw new ConfigError("structuredAI requires a gateway", {
			context: { gateway: String(gateway) },
		});
	}

	const maxRetries = structured.maxRetries ?? DEFAULT_MAX_RETRIES;
	const jsonSchema = standardSchemaToJsonSchema(
		structured.schema as unknown as Parameters<typeof standardSchemaToJsonSchema>[0],
	);

	// Normalize the various `AiInput` shapes into a mutable `messages` array we
	// can append to across retry attempts. `{ prompt }` becomes a single user
	// message; arbitrary input shapes without `messages` or `prompt` error out
	// since we need somewhere to append the self-correction feedback.
	const messages: ChatMessage[] = toMessages(input);

	let lastRaw = "";
	let lastIssues: unknown[] = [];

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const output = await gateway.run(model, { messages }, { responseFormat: { jsonSchema } });
		const rawText = output.text ?? "";
		lastRaw = rawText;

		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch {
			const parseIssues = [{ message: `Invalid JSON: ${rawText.slice(0, 200)}` }];
			lastIssues = parseIssues;

			if (attempt < maxRetries) {
				messages.push({ role: "assistant", content: rawText });
				messages.push({
					role: "user",
					content:
						"Your response was not valid JSON. Please respond with valid JSON matching the schema.",
				});
				continue;
			}
			throw new StructuredOutputError(rawText, parseIssues);
		}

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

				messages.push({ role: "assistant", content: rawText });
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
			provider: output.provider,
			model: output.model,
		};
	}

	throw new StructuredOutputError(lastRaw, lastIssues);
}

function toMessages(input: AiInput): ChatMessage[] {
	if ("messages" in input && Array.isArray((input as { messages: unknown }).messages)) {
		return [...(input as { messages: ChatMessage[] }).messages];
	}
	if ("prompt" in input && typeof (input as { prompt: unknown }).prompt === "string") {
		return [{ role: "user", content: (input as { prompt: string }).prompt }];
	}
	throw new ValidationError(
		"structuredAI requires input with `messages` or `prompt` so self-correction feedback can be appended",
		[{ path: ["input"], message: "Expected { messages: ChatMessage[] } or { prompt: string }" }],
	);
}
