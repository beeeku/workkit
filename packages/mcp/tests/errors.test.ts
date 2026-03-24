// tests/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  toMCPToolError,
  toJsonRpcError,
  toRestError,
  MCPProtocolError,
} from "../src/errors";
import { ValidationError, UnauthorizedError, TimeoutError } from "@workkit/errors";

describe("toMCPToolError", () => {
  it("wraps WorkkitError as isError result", () => {
    const error = new ValidationError("bad input", [{ message: "Required", path: ["query"] }]);
    const result = toMCPToolError(error);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Validation error");
  });

  it("wraps unknown error with generic message in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const error = new Error("secret internal details");
    const result = toMCPToolError(error);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("secret internal details");
    expect(result.content[0].text).toContain("Internal error");

    process.env.NODE_ENV = original;
  });

  it("includes details in development mode", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const error = new Error("debug details");
    const result = toMCPToolError(error);

    expect(result.content[0].text).toContain("debug details");

    process.env.NODE_ENV = original;
  });
});

describe("toJsonRpcError", () => {
  it("maps parse error to -32700", () => {
    const error = MCPProtocolError.parseError("Invalid JSON");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32700);
    expect(rpc.message).toBe("Parse error");
  });

  it("maps method not found to -32601", () => {
    const error = MCPProtocolError.methodNotFound("unknown/method");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32601);
  });

  it("maps invalid params to -32602", () => {
    const error = MCPProtocolError.invalidParams("Missing required field");
    const rpc = toJsonRpcError(error);

    expect(rpc.code).toBe(-32602);
  });
});

describe("toRestError", () => {
  it("maps ValidationError to 400 response", () => {
    const error = new ValidationError("bad", []);
    const response = toRestError(error);

    expect(response.status).toBe(400);
  });

  it("maps UnauthorizedError to 401 response", () => {
    const error = new UnauthorizedError("no token");
    const response = toRestError(error);

    expect(response.status).toBe(401);
  });

  it("maps TimeoutError to 504 response", () => {
    const error = new TimeoutError("too slow");
    const response = toRestError(error);

    expect(response.status).toBe(504);
  });

  it("maps unknown error to 500 response", () => {
    const error = new Error("oops");
    const response = toRestError(error);

    expect(response.status).toBe(500);
  });
});
