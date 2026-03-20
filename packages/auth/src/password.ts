import { ValidationError } from "@workkit/errors";
import type { PasswordHash } from "./types";

const DEFAULT_ITERATIONS = 100_000;
const HASH_ALGORITHM = "SHA-256";
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

/** Encode a Uint8Array to hex string */
function toHex(data: Uint8Array): string {
	return Array.from(data)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Decode a hex string to Uint8Array */
function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

/**
 * Hash a password using PBKDF2 via WebCrypto.
 *
 * Returns a structured hash object containing the hash, salt,
 * iteration count, and algorithm for future verification.
 */
export async function hashPassword(
	password: string,
	options?: { iterations?: number },
): Promise<PasswordHash> {
	if (!password) {
		throw new ValidationError("Password cannot be empty");
	}

	const iterations = options?.iterations ?? DEFAULT_ITERATIONS;
	const salt = new Uint8Array(SALT_LENGTH_BYTES);
	crypto.getRandomValues(salt);

	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations,
			hash: HASH_ALGORITHM,
		},
		keyMaterial,
		KEY_LENGTH_BITS,
	);

	return {
		hash: toHex(new Uint8Array(derivedBits)),
		salt: toHex(salt),
		iterations,
		algorithm: `pbkdf2-${HASH_ALGORITHM.toLowerCase()}`,
	};
}

/**
 * Verify a password against a previously hashed value.
 *
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
	const encoder = new TextEncoder();
	const salt = fromHex(stored.salt);

	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations: stored.iterations,
			hash: HASH_ALGORITHM,
		},
		keyMaterial,
		KEY_LENGTH_BITS,
	);

	const derived = new Uint8Array(derivedBits);
	const storedHash = fromHex(stored.hash);

	// Constant-time comparison
	if (derived.length !== storedHash.length) return false;

	let diff = 0;
	for (let i = 0; i < derived.length; i++) {
		diff |= derived[i]! ^ storedHash[i]!;
	}

	return diff === 0;
}
