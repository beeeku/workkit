/**
 * FNV-1a hash that returns a deterministic number in the range 0-99.
 *
 * Used for sticky percentage rollouts: the same input always maps to the same
 * bucket, giving consistent flag assignments per user + flag combination.
 */
export function deterministicHash(input: string): number {
	// FNV-1a 32-bit constants
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// Multiply by FNV prime 0x01000193
		// Use Math.imul for correct 32-bit integer multiplication
		hash = Math.imul(hash, 0x01000193);
	}
	// Convert to unsigned 32-bit integer and map to 0-99
	return ((hash >>> 0) % 100);
}
