/**
 * Error thrown when a structured output response does not match the expected schema
 * after all retry attempts have been exhausted.
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
