import { ValidationError } from "@workkit/errors";
import { assertR2Binding, validateR2Key } from "./errors";
import type { PresignedUrlOptions } from "./types";

/** Maximum presigned URL expiration: 7 days in seconds */
const MAX_EXPIRY = 7 * 24 * 60 * 60;

/** Default expiration: 1 hour */
const DEFAULT_EXPIRY = 3600;

/**
 * Create a presigned URL for direct R2 object access.
 *
 * Note: Cloudflare R2 does not natively support presigned URLs via the
 * Workers API. This function generates a signed URL using HMAC-SHA256
 * that can be verified by a Worker route handler.
 *
 * @param bucket - The R2Bucket binding.
 * @param options - Key, method, expiration, and optional max size.
 * @returns A signed URL string with embedded signature and expiry.
 *
 * @example
 * ```ts
 * const url = await createPresignedUrl(env.MY_BUCKET, {
 *   key: 'uploads/file.pdf',
 *   method: 'PUT',
 *   expiresIn: 3600,
 *   maxSize: 10 * 1024 * 1024,
 * })
 * ```
 */
export async function createPresignedUrl(
	bucket: R2Bucket,
	options: PresignedUrlOptions,
): Promise<string> {
	assertR2Binding(bucket);
	validateR2Key(options.key);

	const expiresIn = options.expiresIn ?? DEFAULT_EXPIRY;

	if (expiresIn <= 0) {
		throw new ValidationError("Presigned URL expiresIn must be positive", [
			{
				path: ["expiresIn"],
				message: `expiresIn must be > 0, got ${expiresIn}`,
				code: "WORKKIT_R2_INVALID_EXPIRY",
			},
		]);
	}

	if (expiresIn > MAX_EXPIRY) {
		throw new ValidationError(
			`Presigned URL expiresIn exceeds maximum of ${MAX_EXPIRY} seconds (7 days)`,
			[
				{
					path: ["expiresIn"],
					message: `expiresIn must be <= ${MAX_EXPIRY}, got ${expiresIn}`,
					code: "WORKKIT_R2_EXPIRY_TOO_LONG",
				},
			],
		);
	}

	if (options.method !== "GET" && options.method !== "PUT") {
		throw new ValidationError(`Presigned URL method must be GET or PUT, got "${options.method}"`, [
			{
				path: ["method"],
				message: `Invalid method: ${options.method}`,
				code: "WORKKIT_R2_INVALID_METHOD",
			},
		]);
	}

	if (options.maxSize !== undefined) {
		if (options.method !== "PUT") {
			throw new ValidationError("maxSize is only valid for PUT presigned URLs", [
				{
					path: ["maxSize"],
					message: "maxSize only applies to PUT method",
					code: "WORKKIT_R2_MAXSIZE_NOT_PUT",
				},
			]);
		}
		if (options.maxSize <= 0) {
			throw new ValidationError("maxSize must be a positive number", [
				{
					path: ["maxSize"],
					message: `maxSize must be > 0, got ${options.maxSize}`,
					code: "WORKKIT_R2_INVALID_MAXSIZE",
				},
			]);
		}
	}

	const expires = Math.floor(Date.now() / 1000) + expiresIn;
	const payload = `${options.method}:${options.key}:${expires}`;

	// Generate HMAC-SHA256 signature using the Web Crypto API.
	// The key material is the caller-supplied signingSecret so that the
	// secret is never embedded in or derivable from the public URL.
	const encoder = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(options.signingSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
	const signature = bufferToHex(signatureBuffer);

	// Build the URL with query parameters
	const params = new URLSearchParams({
		key: options.key,
		method: options.method,
		expires: String(expires),
		signature,
	});

	if (options.maxSize !== undefined) {
		params.set("maxSize", String(options.maxSize));
	}

	return `/_r2/presigned?${params.toString()}`;
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const hex: string[] = [];
	for (const b of bytes) {
		hex.push(b.toString(16).padStart(2, "0"));
	}
	return hex.join("");
}
