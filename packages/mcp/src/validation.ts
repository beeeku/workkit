import type { StandardSchemaV1 } from "./types";

// ─── Result Types ─────────────────────────────────────────────

export type ValidateOk<T> = { ok: true; value: T };
export type ValidateErr = { ok: false; error: { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }> } };
export type ValidateResult<T> = ValidateOk<T> | ValidateErr;

// ─── validateInput ────────────────────────────────────────────

/**
 * Validate input against a Standard Schema v1 schema.
 * Returns { ok: true, value } or { ok: false, error: { issues } }.
 */
export async function validateInput<T>(
  schema: StandardSchemaV1<unknown, T>,
  input: unknown,
): Promise<ValidateResult<T>> {
  const result = await schema["~standard"].validate(input);

  if (result.issues) {
    return {
      ok: false,
      error: { issues: result.issues },
    };
  }

  return { ok: true, value: result.value as T };
}

// ─── JSON Schema Types ────────────────────────────────────────

export interface JsonSchemaObject {
  type: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  [key: string]: unknown;
}

export type JsonSchema = Record<string, unknown>;

// ─── schemaToJsonSchema ───────────────────────────────────────

/**
 * Convert a Standard Schema (Zod v4 or compatible) to a JSON Schema object.
 *
 * For Zod v4 schemas with toJSONSchema(), uses the built-in method and strips
 * the $schema meta key. For other schemas, falls back to inspecting the _zod.def
 * or returning {}.
 */
export function schemaToJsonSchema(schema: StandardSchemaV1): JsonSchema {
  // Zod v4: use built-in toJSONSchema() method
  if (typeof (schema as any).toJSONSchema === "function") {
    const full = (schema as any).toJSONSchema() as Record<string, unknown>;
    // Remove JSON Schema $schema meta key — callers typically want the plain schema object
    const { $schema: _meta, ...rest } = full;
    return rest as JsonSchema;
  }

  // Fallback: try to inspect _zod.def for Zod-compatible schemas
  const def = (schema as any)?._zod?.def ?? (schema as any)?._def;
  if (def) {
    return convertDef(def);
  }

  // Unknown schema type — return empty object
  return {};
}

// ─── Internal fallback converter (used when toJSONSchema is unavailable) ─────

function convertDef(def: Record<string, unknown>): JsonSchema {
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
        items: items ? convertDef((items as any)?._zod?.def ?? (items as any)?._def ?? {}) : {},
      };
    }

    case "object": {
      const shape = def.shape as Record<string, unknown> | undefined;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      if (shape) {
        for (const [key, field] of Object.entries(shape)) {
          const fieldDef = (field as any)?._zod?.def ?? (field as any)?._def ?? {};
          const fieldSchema = convertDef(fieldDef);
          properties[key] = fieldSchema;

          // Mark as required if not optional/default/nullable
          const fieldType = fieldDef.type as string | undefined;
          if (fieldType !== "optional" && fieldType !== "default" && fieldType !== "nullable") {
            required.push(key);
          }
        }
      }

      const result: JsonSchema = { type: "object", properties };
      if (required.length > 0) result.required = required;
      return result;
    }

    case "enum": {
      const values = def.values ?? def.entries;
      return { type: "string", enum: Array.isArray(values) ? values : Object.values(values as object) };
    }

    case "literal": {
      const value = def.value;
      return { const: value };
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
