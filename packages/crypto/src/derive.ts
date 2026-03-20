import { encode } from "./encoding";

/**
 * Derive an AES-256-GCM key.
 *
 * - If `source` is a string: uses PBKDF2 with the string as password and `context` as salt.
 * - If `source` is a CryptoKey: uses HKDF with the key as input key material and `context` as info.
 */
export async function deriveKey(source: string | CryptoKey, context: string): Promise<CryptoKey> {
	if (typeof source === "string") {
		return derivePBKDF2(source, context);
	}
	return deriveHKDF(source, context);
}

async function derivePBKDF2(password: string, salt: string): Promise<CryptoKey> {
	const keyMaterial = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, [
		"deriveKey",
	]);

	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: encode(salt),
			iterations: 100_000,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
}

async function deriveHKDF(masterKey: CryptoKey, info: string): Promise<CryptoKey> {
	// Export the master key to use as IKM for HKDF
	const rawKey = await crypto.subtle.exportKey("raw", masterKey);

	const keyMaterial = await crypto.subtle.importKey("raw", rawKey, "HKDF", false, ["deriveKey"]);

	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(0), // Empty salt — context goes in info
			info: encode(info),
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
}
