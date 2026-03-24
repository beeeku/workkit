// src/transport.ts
import type { JsonRpcRequest, JsonRpcResponse } from "./types";
import type { ProtocolHandler } from "./protocol";

// ─── Config ──────────────────────────────────────────────────

export interface TransportHandlerConfig {
  protocol: ProtocolHandler;
  maxBatchSize?: number;
}

export interface TransportHandler {
  handleRequest(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
}

// ─── Response Helpers ────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rpcErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  status = 400,
): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

// ─── Validation ──────────────────────────────────────────────

function isValidRpcObject(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

function validateRpcMessage(obj: unknown): { ok: true; message: JsonRpcRequest } | { ok: false; error: string } {
  if (!isValidRpcObject(obj)) {
    return { ok: false, error: "Expected a JSON-RPC object" };
  }
  if (obj["jsonrpc"] !== "2.0") {
    return { ok: false, error: 'Missing or invalid "jsonrpc" field — must be "2.0"' };
  }
  if (typeof obj["method"] !== "string") {
    return { ok: false, error: 'Missing or invalid "method" field' };
  }
  return { ok: true, message: obj as unknown as JsonRpcRequest };
}

// ─── Transport Handler ───────────────────────────────────────

export function createTransportHandler(config: TransportHandlerConfig): TransportHandler {
  const { protocol, maxBatchSize = 10 } = config;

  async function handleRequest(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const method = request.method.toUpperCase();

    // Only POST is supported
    if (method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Parse body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return rpcErrorResponse(null, -32700, "Parse error: invalid JSON");
    }

    // Batch request
    if (Array.isArray(raw)) {
      if (raw.length > maxBatchSize) {
        return rpcErrorResponse(
          null,
          -32600,
          `Batch size ${raw.length} exceeds maximum of ${maxBatchSize}`,
        );
      }

      // Validate each message
      const validated: Array<{ ok: true; message: JsonRpcRequest } | { ok: false; index: number }> =
        raw.map((item, i) => {
          const result = validateRpcMessage(item);
          if (!result.ok) return { ok: false, index: i };
          return result;
        });

      // Process all in parallel
      const results = await Promise.allSettled(
        validated.map((v) => {
          if (!v.ok) {
            return Promise.resolve({
              jsonrpc: "2.0" as const,
              id: null,
              error: { code: -32600, message: "Invalid Request" },
            } satisfies JsonRpcResponse);
          }
          return protocol.dispatch(v.message, { env, ctx, request });
        }),
      );

      // Collect non-null responses (filter out notifications)
      const responses: JsonRpcResponse[] = [];
      for (const result of results) {
        if (result.status === "fulfilled" && result.value !== null) {
          responses.push(result.value);
        }
      }

      return jsonResponse(responses);
    }

    // Single request
    const validation = validateRpcMessage(raw);
    if (!validation.ok) {
      return rpcErrorResponse(null, -32600, `Invalid Request: ${validation.error}`);
    }

    const response = await protocol.dispatch(validation.message, { env, ctx, request });

    // Notification — no response body needed, but return 200 for HTTP conformance
    if (response === null) {
      return new Response(null, { status: 200 });
    }

    return jsonResponse(response);
  }

  return { handleRequest };
}
