/**
 * Lightweight Standard Schema → JSON Schema converter.
 *
 * Prefers the schema's own `toJSONSchema()` method (Zod v4+, Valibot, ArkType).
 * Otherwise falls back to inspecting Zod's internal `_zod.def` / `_def`
 * structures. Returns `{ type: "object" }` as a permissive default when the
 * schema shape isn't recognized.
 *
 * Ported from `@workkit/ai` so the structured-output helpers don't have to
 * depend on the deprecated package.
 */

interface StandardSchemaLike {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => unknown;
	};
}

export function standardSchemaToJsonSchema(schema: StandardSchemaLike): Record<string, unknown> {
	// biome-ignore lint/suspicious/noExplicitAny: Schema libraries expose toJSONSchema without a standard type.
	if (typeof (schema as any).toJSONSchema === "function") {
		// biome-ignore lint/suspicious/noExplicitAny: same reason.
		const full = (schema as any).toJSONSchema() as Record<string, unknown>;
		const { $schema: _meta, ...rest } = full;
		return rest;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Inspecting Zod's private defs.
	const def = (schema as any)?._zod?.def ?? (schema as any)?._def;
	if (def) return convertDef(def);

	return { type: "object" };
}

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
			// biome-ignore lint/suspicious/noExplicitAny: Zod internal shape.
			const items = def.element ?? (def as any).items;
			return {
				type: "array",
				// biome-ignore lint/suspicious/noExplicitAny: Zod internal shape.
				items: items ? convertDef((items as any)?._zod?.def ?? (items as any)?._def ?? {}) : {},
			};
		}

		case "object": {
			const shape = def.shape as Record<string, unknown> | undefined;
			const properties: Record<string, Record<string, unknown>> = {};
			const required: string[] = [];

			if (shape) {
				for (const [key, field] of Object.entries(shape)) {
					// biome-ignore lint/suspicious/noExplicitAny: Zod internal shape.
					const fieldDef = (field as any)?._zod?.def ?? (field as any)?._def ?? {};
					properties[key] = convertDef(fieldDef);

					const fieldType = fieldDef.type as string | undefined;
					if (fieldType !== "optional" && fieldType !== "default" && fieldType !== "nullable") {
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

		case "literal":
			return { const: def.value };

		case "optional":
		case "nullable": {
			// biome-ignore lint/suspicious/noExplicitAny: Zod internal shape.
			const inner = (def as any).innerType;
			const innerDef = inner?._zod?.def ?? inner?._def ?? {};
			return convertDef(innerDef);
		}

		case "default": {
			// biome-ignore lint/suspicious/noExplicitAny: Zod internal shape.
			const inner = (def as any).innerType;
			const innerDef = inner?._zod?.def ?? inner?._def ?? {};
			return { ...convertDef(innerDef), default: def.defaultValue };
		}

		default:
			return {};
	}
}
