/**
 * RFC 3464 (multipart/report) DSN parser.
 *
 * Cloudflare's `send_email` binding has no delivery-webhook surface — the
 * only way a Worker learns that an outbound message bounced is when the
 * remote MTA returns a delivery-status notification (DSN) to the sender
 * domain. With Cloudflare Email Routing pointing at a Worker, that DSN
 * arrives as a normal inbound email; this helper detects it and turns it
 * into a structured `BounceInfo` so the caller (typically
 * `@workkit/notify`'s `createBounceRoute`) can drive opt-out.
 *
 * Pure parser — `InboundEmail` in, `BounceInfo | null` out. No I/O.
 */

import type { InboundEmail, ParsedAttachment } from "./types";

export type BounceKind = "hard" | "soft";

export interface BounceInfo {
	readonly kind: BounceKind;
	/** Failed recipient address — parsed from the DSN's `Final-Recipient` field. */
	readonly recipient: string;
	/** RFC 3463 enhanced status code (e.g. "5.1.1"), when present. */
	readonly status?: string;
	/** Verbatim `Diagnostic-Code` field, when present. */
	readonly diagnosticCode?: string;
	/** Original message id (correlation back to the send), when extractable. */
	readonly originalMessageId?: string;
	/** `Reporting-MTA` field, when present. */
	readonly reportingMta?: string;
}

/**
 * Detect and parse an RFC 3464 delivery-status notification.
 *
 * Returns `null` for non-DSN inbound mail (regular messages, auto-replies,
 * vacation responders, malformed DSNs). Returns `null` for DSNs whose
 * `Action` is not `failed` (delayed / relayed / delivered are not bounces).
 *
 * Hard vs soft classification follows the RFC 3463 status-code prefix:
 * `5.x` → hard, `4.x` → soft. Without a status code, falls back to the
 * SMTP class encoded in `Diagnostic-Code` (e.g. `550` → hard, `421` →
 * soft). Ambiguous cases default to `soft` — auto-opt-out is destructive,
 * so we lean conservative.
 */
export function parseBounceDSN(email: InboundEmail): BounceInfo | null {
	const fields = extractDsnFields(email);
	if (!fields) return null;

	// `Action` is mandatory per RFC 3464. Only `failed` is a bounce.
	const action = fields.get("action")?.toLowerCase().trim();
	if (action !== "failed") return null;

	const finalRecipientField = fields.get("final-recipient");
	if (!finalRecipientField) return null;
	const recipient = parseRecipient(finalRecipientField);
	if (!recipient) return null;

	const status = fields.get("status")?.trim();
	const diagnosticCode = fields.get("diagnostic-code")?.trim();
	const reportingMta = fields.get("reporting-mta")?.split(";").pop()?.trim();
	const originalMessageId =
		fields.get("original-message-id")?.trim() ?? extractOriginalMessageId(email);

	return {
		kind: classify(status, diagnosticCode),
		recipient,
		...(status ? { status } : {}),
		...(diagnosticCode ? { diagnosticCode } : {}),
		...(originalMessageId ? { originalMessageId } : {}),
		...(reportingMta ? { reportingMta } : {}),
	};
}

/**
 * Locate the `message/delivery-status` part of a DSN and parse its
 * RFC 822-style fields into a lower-cased name-keyed map.
 *
 * Looks in three places, in priority order:
 * 1. An attachment whose content-type contains `delivery-status` (the
 *    canonical multipart/report layout — postal-mime surfaces this part
 *    as an attachment).
 * 2. The plain-text body, if it carries the canonical DSN markers
 *    (`Final-Recipient:` + `Action:`). Some MTAs collapse single-part
 *    DSNs into the body when the report-type wrapper is dropped.
 * 3. Fail closed (return `null`) if neither path yields a DSN.
 */
function extractDsnFields(email: InboundEmail): Map<string, string> | null {
	for (const att of email.attachments) {
		if (isDeliveryStatusAttachment(att)) {
			const text = decodeAttachmentText(att);
			if (text) return parseFields(text);
		}
	}

	const body = email.text;
	if (body && /^\s*Final-Recipient\s*:/im.test(body) && /^\s*Action\s*:/im.test(body)) {
		return parseFields(body);
	}

	return null;
}

function isDeliveryStatusAttachment(att: ParsedAttachment): boolean {
	return /delivery-status/i.test(att.contentType ?? "");
}

function decodeAttachmentText(att: ParsedAttachment): string | null {
	if (typeof att.content === "string") return att.content;
	try {
		return new TextDecoder().decode(att.content);
	} catch {
		return null;
	}
}

/**
 * Parse RFC 822-style field lines into a Map. Folded continuation lines
 * (lines starting with whitespace) are joined onto the previous field
 * per RFC 5322 §2.2.3. Everything outside the per-recipient field group
 * (the leading per-message group) and inside it is flattened into the
 * same map; for the single-recipient DSNs we care about, that's lossless
 * and matches the RFC 3464 examples.
 */
function parseFields(raw: string): Map<string, string> {
	const out = new Map<string, string>();
	const lines = raw.replace(/\r\n/g, "\n").split("\n");
	let current: { name: string; value: string } | null = null;

	const commit = () => {
		if (current) out.set(current.name, current.value.trim());
	};

	for (const line of lines) {
		if (line === "") continue;
		// Folded continuation: append to the in-flight field.
		if (/^[ \t]/.test(line) && current) {
			current.value += ` ${line.trim()}`;
			continue;
		}
		const match = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/);
		const name = match?.[1];
		const value = match?.[2];
		if (!name) continue;
		commit();
		current = { name: name.toLowerCase(), value: value ?? "" };
	}
	commit();
	return out;
}

/**
 * `Final-Recipient` is `address-type; address` (RFC 3464 §2.3.2). The
 * common type is `rfc822` — a bare email address. Strip surrounding
 * whitespace and angle brackets so the caller sees a clean address.
 */
function parseRecipient(field: string): string | null {
	const semi = field.indexOf(";");
	const addr = (semi >= 0 ? field.slice(semi + 1) : field).trim();
	if (!addr) return null;
	return addr.replace(/^<|>$/g, "").trim() || null;
}

/**
 * Try to recover the original Message-ID. Prefer the explicit
 * `Original-Message-ID` DSN field (already pulled by the caller); when
 * that's absent, scan the `message/rfc822` (or `text/rfc822-headers`)
 * attachment that DSNs typically include for a `Message-ID:` header.
 */
function extractOriginalMessageId(email: InboundEmail): string | undefined {
	for (const att of email.attachments) {
		const ct = att.contentType ?? "";
		if (!/rfc822/i.test(ct)) continue;
		const text = decodeAttachmentText(att);
		if (!text) continue;
		// Only inspect the header block — stop at the first blank line.
		const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? "";
		const fields = parseFields(headerBlock);
		const id = fields.get("message-id");
		if (id) return id;
	}
	return undefined;
}

function classify(status: string | undefined, diagnostic: string | undefined): BounceKind {
	if (status) {
		if (status.startsWith("5.")) return "hard";
		if (status.startsWith("4.")) return "soft";
	}
	if (diagnostic) {
		// `Diagnostic-Code: smtp; 550 5.1.1 …` — the leading 3-digit
		// SMTP reply code is a reliable secondary signal.
		const m = diagnostic.match(/\b([45])\d{2}\b/);
		const cls = m?.[1];
		if (cls) return cls === "5" ? "hard" : "soft";
	}
	// Default: soft. Hard implies "stop sending" (auto-opt-out); when in
	// doubt we'd rather retry than silently drop a real subscriber.
	return "soft";
}
