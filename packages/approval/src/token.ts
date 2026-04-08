import { generateSigningKeyPair, randomUUID, sign } from "@workkit/crypto";
import type { ApprovalTokenPayload } from "./types";

export type { ApprovalTokenPayload };

export interface ApprovalKeys {
	privateKey: CryptoKey;
	publicKey: CryptoKey;
}

export interface TokenResult {
	token: string;
	tokenId: string;
}

export type VerifyOk = { ok: true; value: ApprovalTokenPayload };
export type VerifyErr = { ok: false; error: { code: string; message: string } };
export type VerifyResult = VerifyOk | VerifyErr;

/** Generate an Ed25519 signing key pair for approval tokens. */
export async function generateApprovalKeys(): Promise<ApprovalKeys> {
	return generateSigningKeyPair("Ed25519");
}

function toBase64Url(str: string): string {
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str: string): string {
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	return atob(padded);
}

/**
 * Generate a signed approval token.
 * Format: base64url(JSON payload) + "." + base64(signature)
 */
export async function generateApprovalToken(
	requestId: string,
	approverId: string,
	action: "approve" | "deny" | "both",
	expiresIn: number,
	privateKey: CryptoKey,
): Promise<TokenResult> {
	const now = Math.floor(Date.now() / 1000);
	const payload: ApprovalTokenPayload = {
		v: 1,
		tid: randomUUID(),
		rid: requestId,
		sub: approverId,
		act: action,
		exp: now + Math.floor(expiresIn / 1000),
		iat: now,
		nonce: randomUUID(),
	};

	const encodedPayload = toBase64Url(JSON.stringify(payload));

	// sign() serializes the data before signing — pass the raw JSON string
	const signature = await sign(privateKey, JSON.stringify(payload));

	const token = `${encodedPayload}.${signature}`;
	return { token, tokenId: payload.tid };
}

/**
 * Verify an approval token.
 * Returns Ok(payload) or Err({ code, message }).
 *
 * @param expectedApproverId  Pass `undefined` to skip the approver check (e.g. when the caller
 *                            extracts the approver from the verified payload).
 * @param expectedAction      When provided, checks that `payload.act` matches the requested
 *                            action or is `"both"`.
 */
export async function verifyApprovalToken(
	token: string,
	expectedRequestId: string,
	expectedApproverId: string | undefined,
	publicKey: CryptoKey,
	consumedTokens: Set<string>,
	expectedAction?: "approve" | "deny",
): Promise<VerifyResult> {
	// 1. Split and decode
	const parts = token.split(".");
	if (parts.length !== 2) {
		return {
			ok: false,
			error: {
				code: "MALFORMED_TOKEN",
				message: "Token must have exactly two parts separated by '.'",
			},
		};
	}

	const encodedPayload = parts[0]!;
	const signature = parts[1]!;

	let payload: ApprovalTokenPayload;
	try {
		const json = fromBase64Url(encodedPayload);
		payload = JSON.parse(json) as ApprovalTokenPayload;
	} catch {
		return {
			ok: false,
			error: { code: "MALFORMED_TOKEN", message: "Failed to decode token payload" },
		};
	}

	if (!payload || typeof payload !== "object" || !payload.tid) {
		return {
			ok: false,
			error: { code: "MALFORMED_TOKEN", message: "Invalid token payload structure" },
		};
	}

	// 2. Verify signature
	const isValid = await sign.verify(publicKey, JSON.stringify(payload), signature);
	if (!isValid) {
		return {
			ok: false,
			error: { code: "INVALID_SIGNATURE", message: "Token signature verification failed" },
		};
	}

	// 3. Check expiry
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp <= now) {
		return { ok: false, error: { code: "TOKEN_EXPIRED", message: "Token has expired" } };
	}

	// 4. Check request ID
	if (payload.rid !== expectedRequestId) {
		return {
			ok: false,
			error: {
				code: "REQUEST_MISMATCH",
				message: `Token is for request '${payload.rid}', not '${expectedRequestId}'`,
			},
		};
	}

	// 5. Check approver (skip if expectedApproverId is undefined)
	if (expectedApproverId !== undefined && payload.sub !== expectedApproverId) {
		return {
			ok: false,
			error: {
				code: "APPROVER_MISMATCH",
				message: `Token is for approver '${payload.sub}', not '${expectedApproverId}'`,
			},
		};
	}

	// 6. Check action (skip if expectedAction is undefined)
	if (expectedAction !== undefined && payload.act !== expectedAction && payload.act !== "both") {
		return {
			ok: false,
			error: {
				code: "ACTION_MISMATCH",
				message: `Token action '${payload.act}' does not permit '${expectedAction}'`,
			},
		};
	}

	// 7. Check consumed
	if (consumedTokens.has(payload.tid)) {
		return {
			ok: false,
			error: { code: "TOKEN_ALREADY_USED", message: "Token has already been consumed" },
		};
	}

	return { ok: true, value: payload };
}
