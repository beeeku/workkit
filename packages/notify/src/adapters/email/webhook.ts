import type { WebhookEvent } from "../../types";
import { WebhookSignatureError } from "./errors";

/**
 * Verify a Resend (Svix-format) webhook signature.
 *
 * Header: `svix-signature: v1,<base64> [v1,<base64>...]` — Svix sends one or
 * more `v1,<sig>` pairs. The official Svix spec separates them with a
 * single space, but some forwarders or test harnesses serialize them as
 * comma-separated `v1,<a>,v1,<b>`. We accept both — split on whitespace
 * AND comma, then re-pair `v1,<sig>` tokens.
 *
 * Timestamp: `svix-timestamp` (unix seconds). Id: `svix-id`.
 *
 * Signed string: `${id}.${timestamp}.${rawBody}`. HMAC-SHA256 with the
 * secret (base64-decoded, after stripping `whsec_` prefix).
 */
export async function verifyResendSignature(
	req: Request,
	secret: string,
	options: { maxAgeMs?: number } = {},
): Promise<{ rawBody: string; timestampMs: number }> {
	const sigHeader = req.headers.get("svix-signature");
	const timestampHeader = req.headers.get("svix-timestamp");
	const idHeader = req.headers.get("svix-id");
	if (!sigHeader || !timestampHeader || !idHeader) {
		throw new WebhookSignatureError(
			"resend",
			"missing svix-signature/svix-timestamp/svix-id headers",
		);
	}

	const tsSeconds = Number(timestampHeader);
	if (!Number.isFinite(tsSeconds))
		throw new WebhookSignatureError("resend", "non-numeric svix-timestamp");
	const timestampMs = tsSeconds * 1000;

	const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
	if (Math.abs(Date.now() - timestampMs) > maxAgeMs) {
		throw new WebhookSignatureError("resend", "timestamp outside replay window");
	}

	const rawBody = await req.text();
	const signed = `${idHeader}.${tsSeconds}.${rawBody}`;
	const secretBytes = decodeSecret(secret);
	const key = await crypto.subtle.importKey(
		"raw",
		secretBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
	const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

	const variants = parseSignatureHeader(sigHeader);
	if (variants.length === 0) {
		throw new WebhookSignatureError("resend", "no v1 signature variant present");
	}
	const ok = variants.some((v) => constantTimeEqual(v, expected));
	if (!ok) throw new WebhookSignatureError("resend", "signature mismatch");
	return { rawBody, timestampMs };
}

/**
 * Parse a Svix `signature` header into the list of base64 signature values
 * for the `v1` scheme. Accepts both whitespace-separated and comma-
 * separated pair encodings.
 */
function parseSignatureHeader(header: string): string[] {
	// Split on whitespace AND comma, then walk pairs of `v1,<sig>`.
	const tokens = header.split(/[\s,]+/).filter((t) => t.length > 0);
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "v1" && i + 1 < tokens.length) {
			out.push(tokens[i + 1]!);
			i += 1;
			continue;
		}
		const m = /^v1,(.+)$/.exec(tokens[i]!);
		if (m) out.push(m[1]!);
	}
	return out;
}

function decodeSecret(secret: string): Uint8Array {
	const value = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
	let bin: string;
	try {
		bin = atob(value);
	} catch {
		throw new WebhookSignatureError("resend", "invalid webhook secret encoding");
	}
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

interface ResendEvent {
	type: string;
	created_at?: string;
	data?: { email_id?: string; to?: string[] };
}

export function parseResendEvents(rawBody: string): WebhookEvent[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		return [];
	}
	const events = Array.isArray(parsed) ? parsed : [parsed];
	const out: WebhookEvent[] = [];
	for (const e of events as ResendEvent[]) {
		const status = mapStatus(e.type);
		if (!status) continue;
		const id = e.data?.email_id;
		if (!id) continue;
		const at = e.created_at ? Date.parse(e.created_at) : Date.now();
		out.push({
			channel: "email",
			providerId: id,
			status,
			at: Number.isFinite(at) ? at : Date.now(),
			raw: e,
		});
	}
	return out;
}

function mapStatus(type: string | undefined): WebhookEvent["status"] | undefined {
	switch (type) {
		case "email.delivered":
			return "delivered";
		case "email.bounced":
		case "email.complained":
			return "bounced";
		case "email.opened":
		case "email.clicked":
			return "read";
		default:
			return undefined;
	}
}

export function isComplaint(rawEvent: unknown): boolean {
	const e = rawEvent as ResendEvent;
	return e?.type === "email.complained";
}

export function isHardBounce(rawEvent: unknown): boolean {
	const e = rawEvent as ResendEvent & { data?: { bounce?: { type?: string } } };
	if (e?.type !== "email.bounced") return false;
	const sub = e?.data?.bounce?.type?.toLowerCase();
	if (!sub) return true;
	return sub === "hard" || sub === "permanent";
}

/** Safe JSON.parse — returns `null` on bad input rather than throwing. */
export function safeParseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
