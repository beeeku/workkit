import { toHex } from "./encoding";

/** Generate cryptographically random bytes */
export function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

/** Generate a random hex string (2 hex chars per byte) */
export function randomHex(byteLength: number): string {
	return toHex(randomBytes(byteLength));
}

/** Generate a random UUID v4 */
export function randomUUID(): string {
	return crypto.randomUUID();
}
