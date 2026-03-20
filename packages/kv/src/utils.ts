import { ValidationError } from "@workkit/errors";

export function prefixKey(prefix: string | undefined, key: string): string {
	return prefix ? `${prefix}${key}` : key;
}

export function stripPrefix(prefix: string | undefined, key: string): string {
	if (!prefix) return key;
	return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function validateKey(key: string): void {
	if (!key || key.length === 0) {
		throw new ValidationError("KV key must be a non-empty string", [
			{ path: ["key"], message: "Key is empty", code: "WORKKIT_KV_EMPTY_KEY" },
		]);
	}
	const byteLength = new TextEncoder().encode(key).length;
	if (byteLength > 512) {
		throw new ValidationError(
			`KV key exceeds maximum size of 512 bytes (got ${byteLength} bytes)`,
			[
				{
					path: ["key"],
					message: `Key is ${byteLength} bytes, max is 512`,
					code: "WORKKIT_KV_KEY_TOO_LONG",
				},
			],
		);
	}
}
