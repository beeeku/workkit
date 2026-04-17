import { TurnstileError } from "./errors";
import type { TurnstileResult, TurnstileVerifyOptions } from "./types";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT = 5000;

interface SiteverifyResponse {
	success: boolean;
	challenge_ts: string;
	hostname: string;
	"error-codes": string[];
	action?: string;
	cdata?: string;
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * @param token - The token from the client-side Turnstile widget
 * @param secretKey - Your Turnstile secret key
 * @param options - Additional verification options
 * @returns The verification result with typed fields
 * @throws TurnstileError on network failure or timeout
 */
export async function verifyTurnstile(
	token: string,
	secretKey: string,
	options?: TurnstileVerifyOptions,
): Promise<TurnstileResult> {
	const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	const body: Record<string, string> = {
		secret: secretKey,
		response: token,
	};

	if (options?.remoteIp) {
		body.remoteip = options.remoteIp;
	}

	if (options?.idempotencyKey) {
		body.idempotency_key = options.idempotencyKey;
	}

	let raw: SiteverifyResponse;

	try {
		const res = await fetch(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		raw = (await res.json()) as SiteverifyResponse;
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new TurnstileError(`Turnstile verification timed out after ${timeout}ms`, [], {
				cause: error,
			});
		}
		throw new TurnstileError("Turnstile verification request failed", [], { cause: error });
	} finally {
		clearTimeout(timeoutId);
	}

	const result: TurnstileResult = {
		success: raw.success,
		challengeTs: raw.challenge_ts ?? "",
		hostname: raw.hostname ?? "",
		errorCodes: raw["error-codes"] ?? [],
		action: raw.action,
		cdata: raw.cdata,
	};

	if (options?.expectedAction && result.action !== options.expectedAction) {
		return {
			...result,
			success: false,
			errorCodes: [...result.errorCodes, "action-mismatch"],
		};
	}

	return result;
}
