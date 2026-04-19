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

// ─── structuredWithRetry ────────────────────────────────────
//
// Caller-controlled reprompt loop: callers own the `generate` function, so
// model/gateway/prompt choices stay outside this helper. This is the
// parse-and-reprompt loop only — per-attempt network retry belongs on the
// gateway (`withRetry`).

/**
 * Error thrown by {@link structuredWithRetry} when every attempt fails schema
 * validation. Carries the final attempt count plus the last parse error and
 * raw output so callers can log or fall back.
 */
export class StructuredRetryExhaustedError extends Error {
	readonly attempts: number;
	readonly lastError: unknown;
	readonly lastRaw: unknown;

	constructor(attempts: number, lastError: unknown, lastRaw: unknown, message?: string) {
		super(message ?? `structuredWithRetry exhausted after ${attempts} attempt(s)`);
		this.name = "StructuredRetryExhaustedError";
		this.attempts = attempts;
		this.lastError = lastError;
		this.lastRaw = lastRaw;
	}
}

/** Options for {@link structuredWithRetry}. */
export interface StructuredWithRetryOptions<T> {
	/** Standard Schema v1 validator for the expected output shape. */
	schema: StandardSchemaV1<T>;
	/**
	 * Produce a candidate structured response. Called with `undefined` on the
	 * first attempt and with the previous parse error's `.message` on each
	 * subsequent attempt so the caller can fold it into the prompt.
	 */
	generate: (remindWith?: string) => Promise<{ text?: string; raw?: unknown }>;
	/** Maximum attempts. Must be >= 1; 1 means "validate once, no retry". */
	maxAttempts: number;
	/** Fires on each RETRY (attempts 2..N) with the prior parse error. */
	onAttempt?: (attempt: number, error: unknown) => void;
}

/** Result from a successful {@link structuredWithRetry} call. */
export interface StructuredWithRetryResult<T> {
	/** The parsed, validated data. */
	value: T;
	/** How many attempts it took to get a valid response (1-based). */
	attempts: number;
	/** The `raw` field from the attempt that validated. */
	raw: unknown;
}

function formatIssues(issues: ReadonlyArray<StandardSchemaV1Issue>): string {
	return issues
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
}

/**
 * Run `generate` and validate its output against `schema`, retrying on parse
 * failure up to `maxAttempts` times. The previous attempt's error message is
 * threaded into `generate` so callers control how the reminder is folded into
 * the next prompt.
 *
 * - Schema-validation errors drive the retry loop.
 * - Any other error from `generate` (network, abort, etc.) propagates
 *   immediately — per-attempt retry is the gateway's job, not this helper's.
 * - On exhaustion throws {@link StructuredRetryExhaustedError}.
 *
 * @example
 * ```ts
 * const result = await structuredWithRetry({
 *   schema: MySchema,
 *   generate: (remindWith) => ai(gateway, model, input, {
 *     responseFormat: "json",
 *     system: remindWith ? `${base}\n\nReminder: ${remindWith}` : base,
 *   }),
 *   maxAttempts: 3,
 * });
 * ```
 */
export async function structuredWithRetry<T>(
	opts: StructuredWithRetryOptions<T>,
): Promise<StructuredWithRetryResult<T>> {
	if (!Number.isFinite(opts.maxAttempts) || opts.maxAttempts < 1) {
		throw new ValidationError("structuredWithRetry requires maxAttempts >= 1", [
			{ path: ["maxAttempts"], message: "Expected an integer >= 1" },
		]);
	}

	let lastError: unknown = undefined;
	let lastRaw: unknown = undefined;
	let remindWith: string | undefined;

	for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
		// Fire onAttempt on RETRIES only (attempts 2..N), with the prior error.
		if (attempt > 1) {
			opts.onAttempt?.(attempt, lastError);
		}

		// Non-parse errors (network, etc.) propagate immediately — no retry.
		const output = await opts.generate(remindWith);
		lastRaw = output.raw;
		const rawText = output.text ?? "";

		let parsed: unknown;
		try {
			parsed = JSON.parse(rawText);
		} catch (parseErr) {
			const message =
				parseErr instanceof Error
					? `Invalid JSON: ${parseErr.message}`
					: `Invalid JSON: ${String(parseErr)}`;
			lastError = new Error(message);
			remindWith = message;
			continue;
		}

		const result = await opts.schema["~standard"].validate(parsed);
		if (result.issues) {
			const summary = formatIssues(result.issues);
			lastError = new Error(summary);
			remindWith = summary;
			continue;
		}

		return {
			value: result.value as T,
			attempts: attempt,
			raw: output.raw,
		};
	}

	throw new StructuredRetryExhaustedError(opts.maxAttempts, lastError, lastRaw);
}
