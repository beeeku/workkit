import { encode, toHex } from "./encoding";
import type { HashAlgorithm, HmacFn } from "./types";

/**
 * Hash data with the specified algorithm.
 * Returns a hex string.
 */
export async function hash(algorithm: HashAlgorithm, data: string): Promise<string> {
	const encoded = encode(data);
	const digest = await crypto.subtle.digest(algorithm, encoded);
	return toHex(digest);
}

/**
 * Compute an HMAC-SHA-256 of data with the given secret.
 * Returns a hex string.
 */
export const hmac: HmacFn = Object.assign(
	async function hmac(secret: string, data: string): Promise<string> {
		const key = await importHmacKey(secret);
		const sig = await crypto.subtle.sign("HMAC", key, encode(data));
		return toHex(sig);
	},
	{
		/**
		 * Verify an HMAC-SHA-256 signature.
		 * Uses constant-time comparison via crypto.subtle.verify.
		 */
		async verify(secret: string, data: string, mac: string): Promise<boolean> {
			const expected = await hmac(secret, data);
			// Constant-time comparison: compare all chars
			if (expected.length !== mac.length) return false;
			let diff = 0;
			for (let i = 0; i < expected.length; i++) {
				diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
			}
			return diff === 0;
		},
	},
);

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}
