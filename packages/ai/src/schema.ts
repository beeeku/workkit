/**
 * Lightweight Standard Schema to JSON Schema converter.
 *
 * If the schema exposes a `toJSONSchema()` method (e.g. Zod v4), that is used.
 * Otherwise falls back to inspecting internal `_zod.def` / `_def` structures,
 * and ultimately returns `{ type: "object" }` as a safe default.
 */

interface StandardSchemaLike {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => unknown;
	};
}

/**
 * Convert a Standard Schema to a JSON Schema object.
 *
 * @param schema - A Standard Schema v1 compatible schema
 * @returns A JSON Schema object describing the schema
 */
export function standardSchemaToJsonSchema(schema: StandardSchemaLike): Record<string, unknown> {
	// Prefer built-in toJSONSchema() (Zod v4+, Valibot, ArkType, etc.)
	if (typeof (schema as any).toJSONSchema === "function") {
		const full = (schema as any).toJSONSchema() as Record<string, unknown>;
		const { $schema: _meta, ...rest } = full;
		return rest;
	}

	// Fallback: inspect _zod.def or _def for Zod-compatible schemas
	const def = (schema as any)?._zod?.def ?? (schema as any)?._def;
	if (def) {
		return convertDef(def);
	}

	// Unknown schema type — return a permissive object schema
	return { type: "object" };
}

// ─── Internal fallback converter ─────────────────────────────

function convertDef(def: Record<string, unknown>): Record<string, unknown> {
	const type = def.type as string | undefined;

	switch (type) {
		case "string":
			return { type: "string" };

		case "number":
			return { type: "number" };

		case "boolean":
			return { type: "boolean" };

		case "array": {
			const items = def.element ?? (def as any).items;
			return {
				type: "array",
				items: items
					? convertDef((items as any)?._zod?.def ?? (items as any)?._def ?? {})
					: {},
			};
		}

		case "object": {
			const shape = def.shape as Record<string, unknown> | undefined;
			const properties: Record<string, Record<string, unknown>> = {};
			const required: string[] = [];

			if (shape) {
				for (const [key, field] of Object.entries(shape)) {
					const fieldDef = (field as any)?._zod?.def ?? (field as any)?._def ?? {};
					const fieldSchema = convertDef(fieldDef);
					properties[key] = fieldSchema;

					const fieldType = fieldDef.type as string | undefined;
					if (
						fieldType !== "optional" &&
						fieldType !== "default" &&
						fieldType !== "nullable"
					) {
						required.push(key);
					}
				}
			}

			const result: Record<string, unknown> = { type: "object", properties };
			if (required.length > 0) result.required = required;
			return result;
		}

		case "enum": {
			const values = def.values ?? def.entries;
			return {
				type: "string",
				enum: Array.isArray(values) ? values : Object.values(values as object),
			};
		}

		case "literal": {
			return { const: def.value };
		}

		case "optional":
		case "nullable": {
			const inner = (def as any).innerType;
			const innerDef = inner?._zod?.def ?? inner?._def ?? {};
			return convertDef(innerDef);
		}

		case "default": {
			const inner = (def as any).innerType;
			const innerDef = inner?._zod?.def ?? inner?._def ?? {};
			return { ...convertDef(innerDef), default: def.defaultValue };
		}

		default:
			return {};
	}
}
