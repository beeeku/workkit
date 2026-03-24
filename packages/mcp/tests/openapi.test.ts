// tests/openapi.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateOpenAPISpec } from "../src/openapi";
import { createToolRegistry } from "../src/registry";

describe("generateOpenAPISpec", () => {
  it("generates valid OpenAPI 3.1 spec", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search documents",
      input: z.object({ query: z.string() }),
      output: z.object({ results: z.array(z.string()) }),
      tags: ["search"],
      handler: async () => ({ results: [] }),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test-api",
      serverVersion: "1.0.0",
      description: "Test API",
      basePath: "/api",
      tools,
    });

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("test-api");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("generates path for each tool", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({ query: z.string() }),
      handler: async () => ({}),
    });
    tools.register("create", {
      description: "Create item",
      input: z.object({ name: z.string() }),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    expect(spec.paths["/api/tools/search"]).toBeDefined();
    expect(spec.paths["/api/tools/search"].post).toBeDefined();
    expect(spec.paths["/api/tools/create"]).toBeDefined();
  });

  it("includes request body schema from tool input", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({
        query: z.string(),
        limit: z.number().default(10),
      }),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const requestBody = spec.paths["/api/tools/search"].post.requestBody;
    expect(requestBody.required).toBe(true);
    const schema = requestBody.content["application/json"].schema;
    expect(schema.properties.query).toBeDefined();
  });

  it("includes response schema when output is defined", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({ query: z.string() }),
      output: z.object({ results: z.array(z.string()), total: z.number() }),
      handler: async () => ({ results: [], total: 0 }),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const responses = spec.paths["/api/tools/search"].post.responses;
    expect(responses["200"]).toBeDefined();
    const schema = responses["200"].content["application/json"].schema;
    expect(schema.properties.result).toBeDefined();
  });

  it("includes error response references", () => {
    const tools = createToolRegistry();
    tools.register("test", {
      description: "Test",
      input: z.object({}),
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    const responses = spec.paths["/api/tools/test"].post.responses;
    expect(responses["400"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
  });

  it("includes server URLs when provided", () => {
    const tools = createToolRegistry();
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
      servers: [{ url: "https://api.example.com", description: "Production" }],
    });

    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0].url).toBe("https://api.example.com");
  });

  it("uses tool tags for grouping", () => {
    const tools = createToolRegistry();
    tools.register("search", {
      description: "Search",
      input: z.object({}),
      tags: ["search", "read"],
      handler: async () => ({}),
    });
    tools.freeze();

    const spec = generateOpenAPISpec({
      serverName: "test",
      serverVersion: "1.0.0",
      basePath: "/api",
      tools,
    });

    expect(spec.paths["/api/tools/search"].post.tags).toEqual(["search", "read"]);
  });
});
