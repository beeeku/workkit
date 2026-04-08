// src/errors.ts
import { TimeoutError, errorToResponse, isWorkkitError } from "@workkit/errors";
import type { JsonRpcError, MCPToolResult } from "./types";

// ─── JSON-RPC Error Codes ─────────────────────────────────────

const JSON_RPC_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

type JsonRpcCode = (typeof JSON_RPC_CODES)[keyof typeof JSON_RPC_CODES];

// ─── MCPProtocolError ─────────────────────────────────────────

export class MCPProtocolError extends Error {
	readonly code: JsonRpcCode;
	readonly data?: unknown;

	constructor(code: JsonRpcCode, message: string, data?: unknown) {
		super(message);
		this.name = "MCPProtocolError";
		this.code = code;
		this.data = data;
		Object.setPrototypeOf(this, new.target.prototype);
	}

	static parseError(message: string, data?: unknown): MCPProtocolError {
		return new MCPProtocolError(JSON_RPC_CODES.PARSE_ERROR, message, data);
	}

	static invalidRequest(message: string, data?: unknown): MCPProtocolError {
		return new MCPProtocolError(JSON_RPC_CODES.INVALID_REQUEST, message, data);
	}

	static methodNotFound(method: string, data?: unknown): MCPProtocolError {
		return new MCPProtocolError(
			JSON_RPC_CODES.METHOD_NOT_FOUND,
			`Method not found: ${method}`,
			data,
		);
	}

	static invalidParams(message: string, data?: unknown): MCPProtocolError {
		return new MCPProtocolError(JSON_RPC_CODES.INVALID_PARAMS, message, data);
	}

	static internalError(message: string, data?: unknown): MCPProtocolError {
		return new MCPProtocolError(JSON_RPC_CODES.INTERNAL_ERROR, message, data);
	}
}

// ─── Human-readable labels for WorkkitError codes ────────────

const WORKKIT_ERROR_LABELS: Record<string, string> = {
	WORKKIT_VALIDATION: "Validation error",
	WORKKIT_NOT_FOUND: "Not found",
	WORKKIT_CONFLICT: "Conflict",
	WORKKIT_UNAUTHORIZED: "Unauthorized",
	WORKKIT_FORBIDDEN: "Forbidden",
	WORKKIT_TIMEOUT: "Timeout",
	WORKKIT_RATE_LIMIT: "Rate limit exceeded",
	WORKKIT_SERVICE_UNAVAILABLE: "Service unavailable",
	WORKKIT_INTERNAL: "Internal error",
	WORKKIT_CONFIG: "Configuration error",
	WORKKIT_BINDING: "Binding error",
	WORKKIT_BINDING_NOT_FOUND: "Binding not found",
};

// ─── toMCPToolError ───────────────────────────────────────────

/**
 * Convert any error to an MCPToolResult with isError: true.
 * WorkkitError subclasses use a human-readable label + message format.
 * Unknown errors get "Internal error" in production, full message in development.
 */
export function toMCPToolError(error: unknown): MCPToolResult {
	let text: string;

	if (isWorkkitError(error)) {
		const label = WORKKIT_ERROR_LABELS[error.code] ?? "Error";
		text = `${label}: ${error.message}`;
	} else if (error instanceof Error) {
		const isDev =
			typeof globalThis !== "undefined" &&
			(globalThis as any).process?.env?.NODE_ENV === "development";
		text = isDev ? error.message : "Internal error";
	} else {
		text = "Internal error";
	}

	return {
		isError: true,
		content: [{ type: "text", text }],
	};
}

// ─── toJsonRpcError ───────────────────────────────────────────

const JSON_RPC_CODE_MESSAGES: Record<JsonRpcCode, string> = {
	[-32700]: "Parse error",
	[-32600]: "Invalid request",
	[-32601]: "Method not found",
	[-32602]: "Invalid params",
	[-32603]: "Internal error",
};

/**
 * Convert an MCPProtocolError to a JsonRpcError object with the correct code.
 */
export function toJsonRpcError(error: MCPProtocolError): JsonRpcError {
	return {
		code: error.code,
		message: JSON_RPC_CODE_MESSAGES[error.code] ?? error.message,
		data: error.data,
	};
}

// ─── toRestError ──────────────────────────────────────────────

/**
 * Convert any error to a REST Response.
 * WorkkitError subclasses use errorToResponse for proper HTTP status codes.
 * TimeoutError maps to 504. Unknown errors map to 500.
 */
export function toRestError(error: unknown): Response {
	if (error instanceof TimeoutError) {
		return new Response(
			JSON.stringify({ error: { code: error.code, message: error.message, statusCode: 504 } }),
			{ status: 504, headers: { "Content-Type": "application/json" } },
		);
	}

	if (isWorkkitError(error)) {
		return errorToResponse(error);
	}

	const isDev = typeof globalThis !== "undefined" && (globalThis as any).__DEV__ === true;
	const message = isDev && error instanceof Error ? error.message : "Internal server error";
	return new Response(
		JSON.stringify({ error: { code: "INTERNAL_ERROR", message, statusCode: 500 } }),
		{ status: 500, headers: { "Content-Type": "application/json" } },
	);
}
