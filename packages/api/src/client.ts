import { buildPath, parseQuery } from "./path";
import type { ApiDefinition, ClientConfig } from "./types";

/**
 * Create a typed API client from a router or list of API definitions.
 *
 * The client provides type-safe methods for calling API endpoints,
 * with automatic path parameter interpolation, body serialization,
 * and response deserialization.
 *
 * @example
 * ```ts
 * import { createClient } from '@workkit/api/client'
 *
 * const client = createClient({
 *   baseUrl: 'https://api.example.com',
 *   apis: [getUser, createUser],
 * })
 *
 * const user = await client.call(getUser, { params: { id: '123' } })
 * ```
 */
export function createClient(config: ClientConfig & { apis?: ApiDefinition[] }): ApiClient {
	const { baseUrl, headers: defaultHeaders = {}, fetch: fetchImpl = globalThis.fetch } = config;

	const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

	return {
		async call<TDef extends ApiDefinition>(definition: TDef, input?: CallInput): Promise<unknown> {
			// Build the URL
			const path = input?.params ? buildPath(definition.path, input.params) : definition.path;

			let url = `${normalizedBase}${path}`;

			// Append query parameters
			if (input?.query) {
				const queryStr = new URLSearchParams(input.query as Record<string, string>).toString();
				if (queryStr) {
					url += `?${queryStr}`;
				}
			}

			// Build headers
			const headers: Record<string, string> = {
				...defaultHeaders,
				...(input?.headers ?? {}),
			};

			// Build request options
			const fetchOptions: RequestInit = {
				method: definition.method,
				headers,
			};

			// Add body for non-GET/HEAD methods
			if (
				input?.body !== undefined &&
				definition.method !== "GET" &&
				definition.method !== "HEAD"
			) {
				headers["Content-Type"] = "application/json";
				fetchOptions.body = JSON.stringify(input.body);
			}

			fetchOptions.headers = headers;

			const response = await fetchImpl(url, fetchOptions);

			if (!response.ok) {
				const errorBody = await response.text();
				let parsed: unknown;
				try {
					parsed = JSON.parse(errorBody);
				} catch {
					parsed = { message: errorBody };
				}
				throw new ApiClientError(
					`${definition.method} ${path} failed with status ${response.status}`,
					response.status,
					parsed,
				);
			}

			// Parse response
			const contentType = response.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				return response.json();
			}

			// No content
			if (response.status === 204) {
				return undefined;
			}

			return response.text();
		},

		/**
		 * Create a caller for a specific endpoint.
		 * Useful for creating pre-bound functions.
		 */
		for<TDef extends ApiDefinition>(definition: TDef): (input?: CallInput) => Promise<unknown> {
			return (input) => this.call(definition, input);
		},
	};
}

/** Input for a client call */
export interface CallInput {
	params?: Record<string, string>;
	query?: Record<string, string>;
	body?: unknown;
	headers?: Record<string, string>;
}

/** API client instance */
export interface ApiClient {
	call<TDef extends ApiDefinition>(definition: TDef, input?: CallInput): Promise<unknown>;
	for<TDef extends ApiDefinition>(definition: TDef): (input?: CallInput) => Promise<unknown>;
}

/** Error thrown by the API client */
export class ApiClientError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(message: string, status: number, body: unknown) {
		super(message);
		this.name = "ApiClientError";
		this.status = status;
		this.body = body;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
