import { UnauthorizedError, ValidationError } from "@workkit/errors";
import type {
	DecodedJWT,
	JWTAlgorithm,
	JWTHeader,
	JWTStandardClaims,
	SignJWTOptions,
	VerifyJWTOptions,
} from "./types";

/** Map algorithm name to WebCrypto hash */
const ALGORITHM_HASH: Record<JWTAlgorithm, string> = {
	HS256: "SHA-256",
	HS384: "SHA-384",
	HS512: "SHA-512",
};

/** Parse a duration string (e.g. '1h', '30m', '7d') to seconds */
export function parseDuration(duration: string): number {
	const match = duration.match(/^(\d+)(s|m|h|d|w)$/);
	if (!match) {
		throw new ValidationError(
			`Invalid duration format: "${duration}". Use format like "1h", "30m", "7d"`,
			[{ path: ["duration"], message: `Invalid format: ${duration}` }],
		);
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 3600;
		case "d":
			return value * 86400;
		case "w":
			return value * 604800;
		default:
			throw new ValidationError(`Unknown duration unit: "${unit}"`);
	}
}

/** Base64url encode a Uint8Array */
function base64urlEncode(data: Uint8Array): string {
	const binary = String.fromCharCode(...data);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url encode a string */
function base64urlEncodeString(str: string): string {
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url decode to string */
function base64urlDecode(str: string): string {
	// Restore base64 padding
	const padded = str.replace(/-/g, "+").replace(/_/g, "/");
	const paddingNeeded = (4 - (padded.length % 4)) % 4;
	const withPadding = padded + "=".repeat(paddingNeeded);
	return atob(withPadding);
}

/** Import an HMAC key for the given algorithm */
async function importKey(secret: string, algorithm: JWTAlgorithm): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(secret);

	return crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: ALGORITHM_HASH[algorithm]! },
		false,
		["sign", "verify"],
	);
}

/**
 * Sign a JWT with the given payload and options.
 *
 * Uses WebCrypto HMAC — no external dependencies.
 */
export async function signJWT<T extends Record<string, unknown>>(
	payload: T,
	options: SignJWTOptions,
): Promise<string> {
	const algorithm = options.algorithm ?? "HS256";

	if (!ALGORITHM_HASH[algorithm]) {
		throw new ValidationError(`Unsupported algorithm: "${algorithm}"`, [
			{ path: ["algorithm"], message: `Unsupported: ${algorithm}` },
		]);
	}

	const header: JWTHeader = { alg: algorithm, typ: "JWT" };

	const now = Math.floor(Date.now() / 1000);
	const claims: Record<string, unknown> = { ...payload, iat: now };

	if (options.expiresIn) {
		claims.exp = now + parseDuration(options.expiresIn);
	}
	if (options.issuer) {
		claims.iss = options.issuer;
	}
	if (options.audience) {
		claims.aud = options.audience;
	}
	if (options.notBefore) {
		claims.nbf = now + parseDuration(options.notBefore);
	}
	if (options.jwtId) {
		claims.jti = options.jwtId;
	}

	const headerEncoded = base64urlEncodeString(JSON.stringify(header));
	const payloadEncoded = base64urlEncodeString(JSON.stringify(claims));
	const signingInput = `${headerEncoded}.${payloadEncoded}`;

	const key = await importKey(options.secret, algorithm);
	const encoder = new TextEncoder();
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));

	const signatureEncoded = base64urlEncode(new Uint8Array(signature));

	return `${signingInput}.${signatureEncoded}`;
}

/**
 * Decode a JWT without verifying the signature.
 *
 * Useful for inspecting tokens before verification, or when
 * verification is handled externally.
 */
export function decodeJWT<T = Record<string, unknown>>(token: string): DecodedJWT<T> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new ValidationError("Invalid JWT format: expected 3 dot-separated parts", [
			{ path: ["token"], message: `Expected 3 parts, got ${parts.length}` },
		]);
	}

	try {
		const header = JSON.parse(base64urlDecode(parts[0]!)) as JWTHeader;
		const payload = JSON.parse(base64urlDecode(parts[1]!)) as T & JWTStandardClaims;

		return { header, payload, signature: parts[2]! };
	} catch (error) {
		throw new ValidationError(
			"Invalid JWT: failed to decode header or payload",
			[{ path: ["token"], message: "Failed to decode" }],
			{ cause: error instanceof Error ? error : undefined },
		);
	}
}

/**
 * Verify a JWT and return the typed payload.
 *
 * Validates signature, expiration, not-before, issuer, and audience.
 */
export async function verifyJWT<T = Record<string, unknown>>(
	token: string,
	options: VerifyJWTOptions,
): Promise<T & JWTStandardClaims> {
	const decoded = decodeJWT<T>(token);
	const { header, payload } = decoded;
	const algorithms = options.algorithms ?? ["HS256"];

	// Check algorithm
	if (!algorithms.includes(header.alg)) {
		throw new UnauthorizedError(`JWT algorithm "${header.alg}" is not allowed`, {
			context: { algorithm: header.alg, allowed: algorithms },
		});
	}

	// Verify signature
	const parts = token.split(".");
	const signingInput = `${parts[0]!}.${parts[1]!}`;
	const key = await importKey(options.secret, header.alg);
	const encoder = new TextEncoder();

	// Decode signature from base64url
	const signatureStr = base64urlDecode(parts[2]!);
	const signatureBytes = new Uint8Array(signatureStr.length);
	for (let i = 0; i < signatureStr.length; i++) {
		signatureBytes[i] = signatureStr.charCodeAt(i);
	}

	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signatureBytes,
		encoder.encode(signingInput),
	);

	if (!valid) {
		throw new UnauthorizedError("JWT signature verification failed");
	}

	const now = Math.floor(Date.now() / 1000);
	const tolerance = options.clockTolerance ?? 0;

	// Check expiration
	if (payload.exp !== undefined && now - tolerance > payload.exp) {
		throw new UnauthorizedError("JWT has expired", {
			context: { exp: payload.exp, now },
		});
	}

	// Check not-before
	if (payload.nbf !== undefined && now + tolerance < payload.nbf) {
		throw new UnauthorizedError("JWT is not yet valid", {
			context: { nbf: payload.nbf, now },
		});
	}

	// Check issuer
	if (options.issuer !== undefined && payload.iss !== options.issuer) {
		throw new UnauthorizedError("JWT issuer mismatch", {
			context: { expected: options.issuer, received: payload.iss },
		});
	}

	// Check audience
	if (options.audience !== undefined) {
		const expectedAudiences = Array.isArray(options.audience)
			? options.audience
			: [options.audience];
		const tokenAudiences = Array.isArray(payload.aud)
			? payload.aud
			: payload.aud
				? [payload.aud]
				: [];

		const hasMatch = expectedAudiences.some((aud) => tokenAudiences.includes(aud));
		if (!hasMatch) {
			throw new UnauthorizedError("JWT audience mismatch", {
				context: { expected: options.audience, received: payload.aud },
			});
		}
	}

	return payload;
}
