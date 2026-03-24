// tests/validation.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateInput, schemaToJsonSchema } from "../src/validation";

describe("validateInput", () => {
  it("validates valid input against schema", async () => {
    const schema = z.object({ query: z.string(), limit: z.number().default(10) });
    const result = await validateInput(schema, { query: "test" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ query: "test", limit: 10 });
    }
  });

  it("returns error for invalid input", async () => {
    const schema = z.object({ query: z.string() });
    const result = await validateInput(schema, { query: 123 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns error for missing required fields", async () => {
    const schema = z.object({ query: z.string() });
    const result = await validateInput(schema, {});

    expect(result.ok).toBe(false);
  });
});

describe("schemaToJsonSchema", () => {
  it("converts Zod object to JSON Schema", () => {
    const schema = z.object({
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(100).default(10),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toHaveProperty("query");
    expect(jsonSchema.properties).toHaveProperty("limit");
    expect(jsonSchema.required).toContain("query");
  });

  it("handles nested objects", () => {
    const schema = z.object({
      filter: z.object({
        status: z.enum(["active", "archived"]),
      }),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.properties.filter.type).toBe("object");
  });

  it("handles arrays", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const jsonSchema = schemaToJsonSchema(schema);
    expect(jsonSchema.properties.tags.type).toBe("array");
  });
});
