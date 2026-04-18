import { ValidationError } from "@workkit/errors";

function hasUnsafeKeyChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) return true;
		if (code === 0x5c) return true; // backslash
	}
	return false;
}

/**
 * Build a safe R2 object key from path parts. Rejects components that contain
 * `..`, backslashes, control characters, or that look like absolute paths
 * (leading `/`). Empty parts are rejected (caller likely has a bug).
 *
 * Returns the joined key; throws `ValidationError` on disallowed input rather
 * than silently transforming it — path traversal should be loud at the call
 * site.
 */
export function safeKey(...parts: string[]): string {
	if (parts.length === 0) {
		throw new ValidationError("safeKey requires at least one path component", [
			{ path: ["safeKey"], message: "no path components supplied" },
		]);
	}

	const cleaned: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const raw = parts[i];
		if (typeof raw !== "string" || raw.length === 0) {
			throw new ValidationError("safeKey path component is empty", [
				{ path: ["safeKey", String(i)], message: "empty component" },
			]);
		}
		if (raw === "." || raw === "..") {
			throw new ValidationError("safeKey rejects relative path components", [
				{ path: ["safeKey", String(i)], message: `rejected component: ${raw}` },
			]);
		}
		if (hasUnsafeKeyChar(raw)) {
			throw new ValidationError("safeKey rejects control characters and backslashes", [
				{ path: ["safeKey", String(i)], message: "unsafe character in component" },
			]);
		}
		// Strip leading/trailing slashes from each part; reject if it tries to
		// escape upward via embedded ".." segments.
		const trimmed = raw.replace(/^\/+|\/+$/g, "");
		if (trimmed.length === 0) {
			throw new ValidationError("safeKey path component is only slashes", [
				{ path: ["safeKey", String(i)], message: "component reduced to empty" },
			]);
		}
		const segments = trimmed.split("/");
		for (const seg of segments) {
			if (seg === "" || seg === "." || seg === "..") {
				throw new ValidationError("safeKey rejects empty/relative path segments", [
					{ path: ["safeKey", String(i), seg], message: "disallowed path segment" },
				]);
			}
		}
		cleaned.push(trimmed);
	}
	return cleaned.join("/");
}
