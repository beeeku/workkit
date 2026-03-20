interface CreateRequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
}

/**
 * Request factory for Cloudflare Workers tests.
 * Defaults to GET, http://localhost as base.
 * Auto-serializes object bodies to JSON with Content-Type header.
 */
export function createRequest(path: string, options?: CreateRequestOptions): Request {
	const method = options?.method ?? "GET";

	// Build URL
	let url: string;
	if (path.startsWith("http://") || path.startsWith("https://")) {
		url = path;
	} else {
		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		url = `http://localhost${normalizedPath}`;
	}

	// Build headers
	const headers = new Headers(options?.headers);

	// Build body
	let body: string | undefined;
	if (options?.body !== undefined) {
		if (typeof options.body === "object" && options.body !== null) {
			body = JSON.stringify(options.body);
			if (!headers.has("Content-Type")) {
				headers.set("Content-Type", "application/json");
			}
		} else if (typeof options.body === "string") {
			body = options.body;
		}
	}

	return new Request(url, { method, headers, body });
}
