import type { StandardSchemaV1 } from "@standard-schema/spec";
import { KVValidationError } from "./kv-errors";

/**
 * Validate a deserialized value against a Standard Schema.
 * Used on get() to ensure data integrity.
 */
export async function validateValue<T>(
	schema: StandardSchemaV1<unknown, T>,
	value: unknown,
	key: string,
): Promise<T> {
	const result = schema["~standard"].validate(value);
	const resolved = result instanceof Promise ? await result : result;

	if (resolved.issues) {
		throw new KVValidationError(
			key,
			resolved.issues.map((i) => i.message).join("; "),
			resolved.issues.map((i) => ({
				path: i.path?.map((p) =>
					typeof p === "object" && p !== null && "key" in p
						? (p as { key: PropertyKey }).key
						: (p as PropertyKey),
				),
				message: i.message,
			})),
		);
	}

	return resolved.value as T;
}
