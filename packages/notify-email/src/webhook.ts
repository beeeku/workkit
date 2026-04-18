import type { WebhookEvent } from "@workkit/notify";
import { WebhookSignatureError } from "./errors";

/**
 * Verify a Resend (Svix-format) webhook signature.
 * Header: `svix-signature: v1,<base64>` (or comma-separated multiple variants).
 * Timestamp: `svix-timestamp: <unix-seconds>`.
 * Id: `svix-id: <message-id>`.
 *
 * Signed string format: `${id}.${timestamp}.${rawBody}`. HMAC-SHA256 with
 * the secret (after stripping a `whsec_` prefix and decoding base64).
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
		throw new WebhookSignatureError("missing svix-signature/svix-timestamp/svix-id headers");
	}

	const tsSeconds = Number(timestampHeader);
	if (!Number.isFinite(tsSeconds)) throw new WebhookSignatureError("non-numeric svix-timestamp");
	const timestampMs = tsSeconds * 1000;

	const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
	if (Math.abs(Date.now() - timestampMs) > maxAgeMs) {
		throw new WebhookSignatureError("timestamp outside replay window");
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

	const variants = sigHeader
		.split(/\s+/)
		.filter((v) => v.startsWith("v1,"))
		.map((v) => v.slice("v1,".length));
	if (variants.length === 0) {
		throw new WebhookSignatureError("no v1 signature variant present");
	}
	const ok = variants.some((v) => constantTimeEqual(v, expected));
	if (!ok) throw new WebhookSignatureError("signature mismatch");
	return { rawBody, timestampMs };
}

function decodeSecret(secret: string): Uint8Array {
	const value = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
	const bin = atob(value);
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

/**
 * Map Resend event types to `@workkit/notify` `WebhookEvent` shape.
 * Recognised types:
 *  - email.delivered  → delivered
 *  - email.bounced    → bounced
 *  - email.complained → bounced (we treat as a delivery-side rejection)
 *  - email.opened     → read
 *  - email.clicked    → read (best-effort)
 */
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

/**
 * Did this raw event represent a complaint (spam report)? Used by the
 * adapter to decide whether to write a global opt-out.
 */
export function isComplaint(rawEvent: unknown): boolean {
	const e = rawEvent as ResendEvent;
	return e?.type === "email.complained";
}

/** Did this event represent a hard bounce? Conservative default: only true for explicit subType=hard or top-level type. */
export function isHardBounce(rawEvent: unknown): boolean {
	const e = rawEvent as ResendEvent & { data?: { bounce?: { type?: string } } };
	if (e?.type !== "email.bounced") return false;
	const sub = e?.data?.bounce?.type?.toLowerCase();
	if (!sub) return true; // no sub-type info → treat as hard, conservative on the opt-out side
	return sub === "hard" || sub === "permanent";
}
