// tests/protocol.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createProtocolHandler } from "../src/protocol";
import { createToolRegistry, createResourceRegistry, createPromptRegistry } from "../src/registry";

function setupHandler() {
  const tools = createToolRegistry();
  const resources = createResourceRegistry();
  const prompts = createPromptRegistry();

  tools.register("search", {
    description: "Search docs",
    input: z.object({ query: z.string() }),
    handler: async ({ input }) => ({ results: [`found: ${input.query}`] }),
  });

  resources.register("config://settings", {
    description: "Settings",
    handler: async () => ({
      contents: [{ uri: "config://settings", mimeType: "application/json", text: '{"theme":"dark"}' }],
    }),
  });

  prompts.register("greet", {
    description: "Greet user",
    args: z.object({ name: z.string() }),
    handler: async ({ args }) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: `Hello ${args.name}` } }],
    }),
  });

  tools.freeze();
  resources.freeze();
  prompts.freeze();

  return createProtocolHandler({
    serverName: "test-server",
    serverVersion: "1.0.0",
    tools,
    resources,
    prompts,
  });
}

describe("MCP Protocol Handler", () => {
  it("handles initialize", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });

    expect(result.id).toBe(1);
    expect(result.result).toBeDefined();
    expect(result.result.protocolVersion).toBe("2025-06-18");
    expect(result.result.serverInfo.name).toBe("test-server");
    expect(result.result.capabilities.tools).toBeDefined();
    expect(result.result.capabilities.resources).toBeDefined();
    expect(result.result.capabilities.prompts).toBeDefined();
  });

  it("handles ping", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });

    expect(result.id).toBe(2);
    expect(result.result).toEqual({});
  });

  it("handles tools/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    expect(result.result.tools).toHaveLength(1);
    expect(result.result.tools[0].name).toBe("search");
    expect(result.result.tools[0].inputSchema).toBeDefined();
  });

  it("handles tools/call with valid input", async () => {
    const handler = setupHandler();
    const env = {};
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "search", arguments: { query: "test" } },
      },
      { env, ctx },
    );

    expect(result.result.content).toHaveLength(1);
    expect(result.result.content[0].type).toBe("text");
    expect(JSON.parse(result.result.content[0].text)).toEqual({ results: ["found: test"] });
    expect(result.result.isError).toBeUndefined();
  });

  it("handles tools/call with invalid input", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "search", arguments: { query: 123 } },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.isError).toBe(true);
  });

  it("handles tools/call for unknown tool", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "nonexistent", arguments: {} },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  it("handles resources/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/list",
    });

    expect(result.result.resources).toHaveLength(1);
    expect(result.result.resources[0].uri).toBe("config://settings");
  });

  it("handles resources/read", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "resources/read",
        params: { uri: "config://settings" },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.contents).toHaveLength(1);
    expect(result.result.contents[0].text).toBe('{"theme":"dark"}');
  });

  it("handles prompts/list", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 9,
      method: "prompts/list",
    });

    expect(result.result.prompts).toHaveLength(1);
    expect(result.result.prompts[0].name).toBe("greet");
  });

  it("handles prompts/get", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "prompts/get",
        params: { name: "greet", arguments: { name: "Alice" } },
      },
      { env: {}, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any },
    );

    expect(result.result.messages).toHaveLength(1);
    expect(result.result.messages[0].content.text).toBe("Hello Alice");
  });

  it("handles resources/templates/list", async () => {
    const tools = createToolRegistry();
    const resources = createResourceRegistry();
    const prompts = createPromptRegistry();

    resources.register("db://users/{id}", {
      description: "User by ID",
      handler: async () => ({ contents: [] }),
    });
    resources.register("config://settings", {
      description: "Settings",
      handler: async () => ({ contents: [{ uri: "config://settings", text: "{}" }] }),
    });

    tools.freeze();
    resources.freeze();
    prompts.freeze();

    const handler = createProtocolHandler({
      serverName: "test",
      serverVersion: "1.0.0",
      tools,
      resources,
      prompts,
    });

    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 12,
      method: "resources/templates/list",
    });

    expect(result.result.resourceTemplates).toHaveLength(1);
    expect(result.result.resourceTemplates[0].uriTemplate).toBe("db://users/{id}");
  });

  it("returns method not found for unknown methods", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      id: 11,
      method: "unknown/method",
    });

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
  });

  it("ignores notifications (no id) without error", async () => {
    const handler = setupHandler();
    const result = await handler.dispatch({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(result).toBeNull();
  });
});
