// tests/transport.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createTransportHandler } from "../src/transport";
import { createProtocolHandler } from "../src/protocol";
import { createToolRegistry, createResourceRegistry, createPromptRegistry } from "../src/registry";

function setupProtocol() {
  const tools = createToolRegistry();
  const resources = createResourceRegistry();
  const prompts = createPromptRegistry();

  tools.register("echo", {
    description: "Echo input",
    input: z.object({ msg: z.string() }),
    handler: async ({ input }) => ({ echo: input.msg }),
  });

  tools.freeze();
  resources.freeze();
  prompts.freeze();

  return createProtocolHandler({
    serverName: "test",
    serverVersion: "1.0.0",
    tools,
    resources,
    prompts,
  });
}

function jsonRpcRequest(method: string, params?: Record<string, unknown>, id: number = 1) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

describe("Streamable HTTP Transport", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

  it("handles POST /mcp with JSON-RPC initialize", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      jsonRpcRequest("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      }),
      {},
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.serverInfo.name).toBe("test");
  });

  it("handles POST /mcp with tools/call", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      jsonRpcRequest("tools/call", { name: "echo", arguments: { msg: "hello" } }),
      {},
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.content[0].text).toBe('{"echo":"hello"}');
  });

  it("returns 400 for invalid JSON body", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
      {},
      ctx,
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for missing jsonrpc field", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "ping" }),
      }),
      {},
      ctx,
    );

    expect(response.status).toBe(400);
  });

  it("handles JSON-RPC batch requests", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]),
      }),
      {},
      ctx,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it("rejects batch exceeding maxBatchSize", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol, maxBatchSize: 2 });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "ping" },
          { jsonrpc: "2.0", id: 3, method: "ping" },
        ]),
      }),
      {},
      ctx,
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(-32600);
  });

  it("returns 405 for unsupported methods", async () => {
    const protocol = setupProtocol();
    const transport = createTransportHandler({ protocol });

    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", { method: "PUT" }),
      {},
      ctx,
    );

    expect(response.status).toBe(405);
  });
});
