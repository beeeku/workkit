import type { ParsedPath, PathMatch } from "./types";

/**
 * Parse a path pattern into segments and parameter names.
 *
 * @example
 * parsePath('/users/:id/posts/:postId')
 * // { segments: ['users', ':id', 'posts', ':postId'], params: ['id', 'postId'], pattern: '/users/:id/posts/:postId' }
 */
export function parsePath(pattern: string): ParsedPath {
	const cleaned = pattern.startsWith("/") ? pattern.slice(1) : pattern;
	const segments = cleaned.split("/").filter(Boolean);
	const params = segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1));

	return { segments, params, pattern };
}

/**
 * Match a URL path against a pattern.
 * Returns extracted parameters on match.
 *
 * @example
 * matchPath('/users/:id', '/users/123')
 * // { matched: true, params: { id: '123' } }
 *
 * matchPath('/users/:id', '/posts/123')
 * // { matched: false }
 */
export function matchPath(pattern: string, path: string): PathMatch {
	const patternSegments = parsePath(pattern).segments;
	const pathCleaned = path.startsWith("/") ? path.slice(1) : path;
	const pathSegments = pathCleaned.split("/").filter(Boolean);

	// Check for wildcard at end
	const hasWildcard =
		patternSegments.length > 0 && patternSegments[patternSegments.length - 1] === "*";

	if (hasWildcard) {
		// Wildcard: pattern segments (minus *) must be <= path segments
		const checkSegments = patternSegments.slice(0, -1);
		if (pathSegments.length < checkSegments.length) {
			return { matched: false };
		}

		const params: Record<string, string> = {};
		for (let i = 0; i < checkSegments.length; i++) {
			const seg = checkSegments[i]!;
			if (seg.startsWith(":")) {
				params[seg.slice(1)] = decodeURIComponent(pathSegments[i]!);
			} else if (seg !== pathSegments[i]) {
				return { matched: false };
			}
		}

		// Capture remaining segments as wildcard
		params["*"] = pathSegments.slice(checkSegments.length).join("/");

		return { matched: true, params };
	}

	// Exact segment count match required (no wildcard)
	if (patternSegments.length !== pathSegments.length) {
		return { matched: false };
	}

	const params: Record<string, string> = {};

	for (let i = 0; i < patternSegments.length; i++) {
		const seg = patternSegments[i]!;
		if (seg.startsWith(":")) {
			params[seg.slice(1)] = decodeURIComponent(pathSegments[i]!);
		} else if (seg !== pathSegments[i]) {
			return { matched: false };
		}
	}

	return { matched: true, params };
}

/**
 * Build a URL path from a pattern and parameters.
 *
 * @example
 * buildPath('/users/:id/posts/:postId', { id: '123', postId: '456' })
 * // '/users/123/posts/456'
 */
export function buildPath(pattern: string, params: Record<string, string>): string {
	const { segments } = parsePath(pattern);
	const built = segments.map((seg) => {
		if (seg.startsWith(":")) {
			const key = seg.slice(1);
			const val = params[key];
			if (val === undefined) {
				throw new Error(`Missing path parameter: ${key}`);
			}
			return encodeURIComponent(val);
		}
		return seg;
	});

	return `/${built.join("/")}`;
}

/**
 * Convert a path pattern to an OpenAPI-style path.
 *
 * @example
 * toOpenAPIPath('/users/:id/posts/:postId')
 * // '/users/{id}/posts/{postId}'
 */
export function toOpenAPIPath(pattern: string): string {
	return pattern.replace(/:(\w+)/g, "{$1}");
}

/**
 * Parse query string from a URL into a record.
 */
export function parseQuery(url: string): Record<string, string> {
	const questionMark = url.indexOf("?");
	if (questionMark === -1) return {};

	const query = url.slice(questionMark + 1);
	const params: Record<string, string> = {};

	for (const pair of query.split("&")) {
		const eq = pair.indexOf("=");
		if (eq === -1) {
			params[decodeURIComponent(pair)] = "";
		} else {
			const key = decodeURIComponent(pair.slice(0, eq));
			const value = decodeURIComponent(pair.slice(eq + 1));
			params[key] = value;
		}
	}

	return params;
}
