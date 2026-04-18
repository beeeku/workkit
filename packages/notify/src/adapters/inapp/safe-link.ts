import { UnsafeLinkError } from "./errors";

const DEFAULT_ALLOWED_SCHEMES = ["https:"] as const;

export interface SafeLinkOptions {
	allowedSchemes?: ReadonlyArray<string>;
	/**
	 * Allow relative paths that start with `/` (e.g. `/briefs/r1`). Default true.
	 * Protocol-relative URLs (`//host/...`) are always rejected; bare paths
	 * without a leading `/` are not accepted either.
	 */
	allowRelative?: boolean;
}

/**
 * Sanity-check a deep-link URL: only schemes in the allowlist (default
 * `https:`) are permitted; relative paths (`/foo`) are allowed by default.
 * `javascript:`, `data:`, `file:` always rejected.
 *
 * Returns the input unchanged on success; throws `UnsafeLinkError` otherwise.
 */
export function safeLink(value: string, options: SafeLinkOptions = {}): string {
	const allowed = options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
	const allowRelative = options.allowRelative !== false;
	const trimmed = value.trim();
	if (trimmed.length === 0) throw new UnsafeLinkError(value, "empty link");

	if (allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		return trimmed;
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new UnsafeLinkError(value, "not a valid URL");
	}
	if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "file:") {
		throw new UnsafeLinkError(value, `disallowed scheme ${url.protocol}`);
	}
	if (!allowed.includes(url.protocol)) {
		throw new UnsafeLinkError(value, `scheme ${url.protocol} not in allowlist`);
	}
	return trimmed;
}
