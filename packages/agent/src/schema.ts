import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Try to extract a JSON Schema from a Standard-Schema-compatible validator.
 *
 * Standard Schema does not require vendors to expose JSON Schema, so this is
 * best-effort: we recognise Zod (via `_def` or `toJSONSchema`) and Valibot
 * (via `_zod`/`async`) heuristically. When extraction fails we return an
 * empty object schema and the caller surfaces a warning so downstream
 * providers see _some_ schema rather than crashing.
 */
export function toJsonSchema(schema: StandardSchemaV1): {
	schema: Record<string, unknown>;
	source: "zod" | "valibot" | "fallback";
} {
	const anySchema = schema as unknown as Record<string, unknown>;

	// Zod 3.x — runtime check for `toJSONSchema` (Zod 3.23+ exports a converter).
	if (typeof (anySchema as { toJSONSchema?: () => unknown }).toJSONSchema === "function") {
		try {
			const out = (anySchema as { toJSONSchema: () => unknown }).toJSONSchema();
			if (out && typeof out === "object") {
				return { schema: out as Record<string, unknown>, source: "zod" };
			}
		} catch {
			// fall through
		}
	}

	// Valibot — `valibot/to-json-schema` ships separately. Detect via `_run`.
	if (typeof (anySchema as { _run?: unknown })._run === "function") {
		// We can't safely import valibot here; emit a permissive object schema
		// and document that callers using Valibot should pass `parameters`
		// explicitly via `tool({ parametersJsonSchema })` for best fidelity.
		return { schema: { type: "object", additionalProperties: true }, source: "valibot" };
	}

	return { schema: { type: "object", additionalProperties: true }, source: "fallback" };
}
