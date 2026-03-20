import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Validates a single value against a Standard Schema.
 * Handles both sync and async validators (Standard Schema allows either).
 */
export async function validateValue(
	schema: StandardSchemaV1,
	value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
	const result = schema["~standard"].validate(value);
	return result instanceof Promise ? result : result;
}

/**
 * Validates a single value synchronously. Throws if the validator returns a Promise.
 */
export function validateValueSync(
	schema: StandardSchemaV1,
	value: unknown,
): StandardSchemaV1.Result<unknown> {
	const result = schema["~standard"].validate(value);
	if (result instanceof Promise) {
		throw new Error("Validator returned a Promise. Use the async variant instead.");
	}
	return result;
}

/**
 * Type guard: is this object a Standard Schema?
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	if (typeof value !== "object" || value === null || !("~standard" in value)) return false;
	const standard = (value as Record<string, unknown>)["~standard"];
	return (
		typeof standard === "object" &&
		standard !== null &&
		typeof (standard as Record<string, unknown>).validate === "function"
	);
}
