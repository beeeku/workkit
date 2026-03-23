/**
 * Create a prefixed key from a base key.
 */
export function prefixKey(prefix: string | undefined, key: string): string {
	if (!prefix) return key;
	return `${prefix}${key}`;
}

/**
 * Strip prefix from a key.
 * Used when returning keys from list operations.
 */
export function stripPrefix(prefix: string | undefined, key: string): string {
	if (!prefix) return key;
	if (!key.startsWith(prefix)) return key;
	return key.slice(prefix.length);
}

/**
 * Combine a client prefix with a list prefix.
 * list({ prefix: 'active:' }) on a client with prefix 'user:'
 * -> searches for 'user:active:*'
 */
export function combinePrefixes(
	clientPrefix: string | undefined,
	listPrefix: string | undefined,
): string | undefined {
	if (!clientPrefix && !listPrefix) return undefined;
	return `${clientPrefix ?? ""}${listPrefix ?? ""}`;
}
