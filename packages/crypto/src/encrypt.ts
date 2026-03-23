import { decode, encode, fromBase64, toBase64 } from "./encoding";

const IV_LENGTH = 12; // 96 bits, recommended for AES-GCM

/**
 * Encrypt data with AES-256-GCM.
 *
 * Accepts strings or any JSON-serializable value. Returns a base64 string
 * containing the 12-byte IV prepended to the ciphertext.
 *
 * @param key - An AES-GCM CryptoKey (use `deriveKey()` to create one).
 * @param data - The value to encrypt (string or JSON-serializable).
 * @returns Base64-encoded ciphertext with embedded IV.
 *
 * @example
 * ```ts
 * const key = await deriveKey(secret, salt)
 * const token = await encrypt(key, { userId: '123', role: 'admin' })
 * ```
 */
export async function encrypt(key: CryptoKey, data: unknown): Promise<string> {
	const plaintext = typeof data === "string" ? data : JSON.stringify(data);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

	// Concatenate IV + ciphertext
	const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), IV_LENGTH);

	return toBase64(combined);
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by `encrypt()`.
 *
 * Extracts the IV prefix, decrypts, and auto-parses JSON if the plaintext
 * is valid JSON; otherwise returns the raw string.
 *
 * @param key - The same AES-GCM CryptoKey used to encrypt.
 * @param ciphertext - Base64-encoded string from `encrypt()`.
 * @returns The original value (parsed from JSON if applicable).
 *
 * @example
 * ```ts
 * const data = await decrypt(key, token) // { userId: '123', role: 'admin' }
 * ```
 */
export async function decrypt(key: CryptoKey, ciphertext: string): Promise<unknown> {
	if (!ciphertext) throw new Error("Cannot decrypt empty ciphertext");

	const combined = fromBase64(ciphertext);
	if (combined.length <= IV_LENGTH) {
		throw new Error("Ciphertext too short");
	}

	const iv = combined.slice(0, IV_LENGTH);
	const data = combined.slice(IV_LENGTH);

	const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);

	const plaintext = decode(plainBuffer);

	// Try to parse as JSON, return raw string if it fails
	try {
		return JSON.parse(plaintext);
	} catch {
		return plaintext;
	}
}

/**
 * Encrypt data with AES-256-GCM and Additional Authenticated Data (AAD).
 * The AAD is verified during decryption but never encrypted.
 */
export async function encryptWithAAD(key: CryptoKey, data: unknown, aad: string): Promise<string> {
	const plaintext = typeof data === "string" ? data : JSON.stringify(data);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = encode(plaintext);
	const additionalData = encode(aad);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData },
		key,
		encoded,
	);

	const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), IV_LENGTH);

	return toBase64(combined);
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by encryptWithAAD().
 * The same AAD used during encryption must be provided.
 */
export async function decryptWithAAD(
	key: CryptoKey,
	ciphertext: string,
	aad: string,
): Promise<unknown> {
	if (!ciphertext) throw new Error("Cannot decrypt empty ciphertext");

	const combined = fromBase64(ciphertext);
	if (combined.length <= IV_LENGTH) {
		throw new Error("Ciphertext too short");
	}

	const iv = combined.slice(0, IV_LENGTH);
	const data = combined.slice(IV_LENGTH);
	const additionalData = encode(aad);

	const plainBuffer = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv, additionalData },
		key,
		data,
	);

	const plaintext = decode(plainBuffer);

	try {
		return JSON.parse(plaintext);
	} catch {
		return plaintext;
	}
}
