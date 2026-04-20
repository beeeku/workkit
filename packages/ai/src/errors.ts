/**
 * Error thrown when a structured output response does not match the expected schema
 * after all retry attempts have been exhausted.
 *
 * @deprecated Re-exported from `@workkit/ai-gateway` — import from there going
 * forward. Per [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md),
 * `@workkit/ai` will be removed at v2.0; track migration via
 * [#63](https://github.com/beeeku/workkit/issues/63).
 */
export class StructuredOutputError extends Error {
	/** The raw string response from the model */
	readonly raw: string;
	/** Validation issues from the schema */
	readonly issues: unknown[];

	constructor(raw: string, issues: unknown[], message?: string) {
		super(message ?? "Response did not match expected schema");
		this.name = "StructuredOutputError";
		this.raw = raw;
		this.issues = issues;
	}
}
