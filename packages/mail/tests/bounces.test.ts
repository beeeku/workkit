import { describe, expect, it } from "vitest";
import { parseBounceDSN } from "../src/bounces";
import { parseEmail } from "../src/parser";
import type { InboundEmail, ParsedAttachment } from "../src/types";

/**
 * Build an InboundEmail-shaped object from a raw multipart/report MIME
 * string by routing through `parseEmail`. The convenience methods
 * (`forward` / `reply` / `setReject`) are stubbed because `parseBounceDSN`
 * never calls them — it's a pure parser over the typed fields.
 */
async function inboundFromRaw(raw: string): Promise<InboundEmail> {
	const parsed = await parseEmail(raw);
	const headers = headersFromRaw(raw);
	return {
		from: parsed.from,
		to: parsed.to,
		subject: parsed.subject,
		text: parsed.text,
		html: parsed.html,
		headers,
		rawSize: raw.length,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		references: parsed.references,
		date: parsed.date,
		attachments: parsed.attachments as readonly ParsedAttachment[],
		forward: async () => {},
		reply: async () => {},
		setReject: () => {},
	};
}

function headersFromRaw(raw: string): Headers {
	const out = new Headers();
	const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
	let current: { name: string; value: string } | null = null;
	const commit = () => {
		if (current) out.set(current.name, current.value);
	};
	for (const line of headerBlock.split(/\r?\n/)) {
		if (/^[ \t]/.test(line) && current) {
			current.value += ` ${line.trim()}`;
			continue;
		}
		const m = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/);
		if (!m) continue;
		commit();
		current = { name: m[1], value: m[2] };
	}
	commit();
	return out;
}

const CRLF = "\r\n";

function gmailHardBounce(): string {
	const boundary = "BoundaryGmail";
	return [
		"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
		"To: sender@entryexit.ai",
		"Subject: Delivery Status Notification (Failure)",
		"Date: Mon, 25 Mar 2026 10:00:00 +0000",
		"MIME-Version: 1.0",
		`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=UTF-8",
		"",
		"Address not found.",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; googlemail.com",
		"",
		"Final-Recipient: rfc822; nonexistent@example.com",
		"Action: failed",
		"Status: 5.1.1",
		"Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
		"",
		`--${boundary}`,
		"Content-Type: message/rfc822",
		"",
		"From: sender@entryexit.ai",
		"To: nonexistent@example.com",
		"Subject: Welcome",
		"Message-ID: <orig-abc123@entryexit.ai>",
		"",
		"hello",
		`--${boundary}--`,
	].join(CRLF);
}

function gmailSoftBounce(): string {
	const boundary = "BoundarySoft";
	return [
		"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
		"To: sender@entryexit.ai",
		"Subject: Delivery Status Notification (Delay)",
		`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
		"MIME-Version: 1.0",
		"",
		`--${boundary}`,
		"Content-Type: text/plain",
		"",
		"Mailbox temporarily full.",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; googlemail.com",
		"",
		"Final-Recipient: rfc822; <full@example.com>",
		"Action: failed",
		"Status: 4.2.2",
		"Diagnostic-Code: smtp; 452 4.2.2 Mailbox full",
		`--${boundary}--`,
	].join(CRLF);
}

function outlookHardBounce(): string {
	const boundary = "BoundaryOutlook";
	return [
		"From: postmaster@outlook.com",
		"To: sender@entryexit.ai",
		"Subject: Undeliverable: Your message",
		`Content-Type: multipart/report; report-type=delivery-status; boundary="${boundary}"`,
		"MIME-Version: 1.0",
		"",
		`--${boundary}`,
		"Content-Type: text/html",
		"",
		"<p>Your message could not be delivered.</p>",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns;outlook.com",
		"",
		"Final-Recipient: rfc822;gone@hotmail.com",
		"Action: failed",
		"Status: 5.0.0",
		"Diagnostic-Code: smtp;550 5.5.0 Requested action not taken: mailbox unavailable",
		`--${boundary}--`,
	].join(CRLF);
}

function delayedNonBounce(): string {
	const boundary = "BoundaryDelayed";
	return [
		"From: postmaster@example.com",
		"To: sender@entryexit.ai",
		"Subject: Delivery delayed",
		`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
		"MIME-Version: 1.0",
		"",
		`--${boundary}`,
		"Content-Type: text/plain",
		"",
		"We will keep trying.",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; example.com",
		"",
		"Final-Recipient: rfc822; user@example.com",
		"Action: delayed",
		"Status: 4.4.7",
		`--${boundary}--`,
	].join(CRLF);
}

function plainNonDsn(): string {
	return [
		"From: friend@example.com",
		"To: sender@entryexit.ai",
		"Subject: Hi there",
		"Content-Type: text/plain",
		"MIME-Version: 1.0",
		"",
		"Just saying hi.",
	].join(CRLF);
}

function autoReplyNonDsn(): string {
	return [
		"From: oof@example.com",
		"To: sender@entryexit.ai",
		"Subject: Out of office: Your message",
		"Auto-Submitted: auto-replied",
		"Content-Type: text/plain",
		"MIME-Version: 1.0",
		"",
		"I am out of office until next week.",
	].join(CRLF);
}

function malformedDsnNoFinalRecipient(): string {
	const boundary = "BoundaryMalformed";
	return [
		"From: postmaster@example.com",
		"To: sender@entryexit.ai",
		"Subject: Undeliverable",
		`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
		"MIME-Version: 1.0",
		"",
		`--${boundary}`,
		"Content-Type: text/plain",
		"",
		"Bad news.",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; example.com",
		"",
		"Action: failed",
		"Status: 5.5.0",
		`--${boundary}--`,
	].join(CRLF);
}

function noStatusBounceWithDiagnosticHard(): string {
	const boundary = "BoundaryNoStatus";
	return [
		"From: postmaster@example.com",
		"To: sender@entryexit.ai",
		"Subject: Undeliverable",
		`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
		"MIME-Version: 1.0",
		"",
		`--${boundary}`,
		"Content-Type: text/plain",
		"",
		"Bad news.",
		"",
		`--${boundary}`,
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; example.com",
		"",
		"Final-Recipient: rfc822; gone@example.com",
		"Action: failed",
		"Diagnostic-Code: smtp; 550 user unknown",
		`--${boundary}--`,
	].join(CRLF);
}

describe("parseBounceDSN()", () => {
	it("parses Gmail hard bounce → kind:'hard', recipient, status, diagnostic, originalMessageId", async () => {
		const email = await inboundFromRaw(gmailHardBounce());
		const info = parseBounceDSN(email);
		expect(info).not.toBeNull();
		expect(info?.kind).toBe("hard");
		expect(info?.recipient).toBe("nonexistent@example.com");
		expect(info?.status).toBe("5.1.1");
		expect(info?.diagnosticCode).toMatch(/550 5\.1\.1/);
		expect(info?.reportingMta).toBe("googlemail.com");
		expect(info?.originalMessageId).toBe("<orig-abc123@entryexit.ai>");
	});

	it("classifies a 4.x status as soft bounce", async () => {
		const email = await inboundFromRaw(gmailSoftBounce());
		const info = parseBounceDSN(email);
		expect(info?.kind).toBe("soft");
		expect(info?.recipient).toBe("full@example.com");
		expect(info?.status).toBe("4.2.2");
	});

	it("parses Outlook-style hard bounce (no quotes around report-type, html sibling part)", async () => {
		const email = await inboundFromRaw(outlookHardBounce());
		const info = parseBounceDSN(email);
		expect(info?.kind).toBe("hard");
		expect(info?.recipient).toBe("gone@hotmail.com");
		expect(info?.status).toBe("5.0.0");
	});

	it("returns null when Action is 'delayed' (not a bounce)", async () => {
		const email = await inboundFromRaw(delayedNonBounce());
		expect(parseBounceDSN(email)).toBeNull();
	});

	it("returns null for plain inbound mail", async () => {
		const email = await inboundFromRaw(plainNonDsn());
		expect(parseBounceDSN(email)).toBeNull();
	});

	it("returns null for an out-of-office auto-reply (not a DSN even though it's automated)", async () => {
		const email = await inboundFromRaw(autoReplyNonDsn());
		expect(parseBounceDSN(email)).toBeNull();
	});

	it("returns null when the delivery-status part is missing Final-Recipient", async () => {
		const email = await inboundFromRaw(malformedDsnNoFinalRecipient());
		expect(parseBounceDSN(email)).toBeNull();
	});

	it("falls back to Diagnostic-Code's SMTP class when Status is absent", async () => {
		const email = await inboundFromRaw(noStatusBounceWithDiagnosticHard());
		const info = parseBounceDSN(email);
		expect(info?.kind).toBe("hard");
		expect(info?.recipient).toBe("gone@example.com");
		expect(info?.status).toBeUndefined();
	});

	it("defaults to soft when classification is ambiguous (no status, no diagnostic)", async () => {
		const boundary = "BoundaryAmb";
		const raw = [
			"From: postmaster@example.com",
			"To: sender@entryexit.ai",
			"Subject: Undeliverable",
			`Content-Type: multipart/report; report-type="delivery-status"; boundary="${boundary}"`,
			"MIME-Version: 1.0",
			"",
			`--${boundary}`,
			"Content-Type: text/plain",
			"",
			"...",
			"",
			`--${boundary}`,
			"Content-Type: message/delivery-status",
			"",
			"Reporting-MTA: dns; example.com",
			"",
			"Final-Recipient: rfc822; ambiguous@example.com",
			"Action: failed",
			`--${boundary}--`,
		].join(CRLF);
		const email = await inboundFromRaw(raw);
		const info = parseBounceDSN(email);
		expect(info?.kind).toBe("soft");
		expect(info?.recipient).toBe("ambiguous@example.com");
	});

	it("strips angle brackets from Final-Recipient values", async () => {
		const email = await inboundFromRaw(gmailSoftBounce());
		const info = parseBounceDSN(email);
		expect(info?.recipient).not.toContain("<");
		expect(info?.recipient).not.toContain(">");
	});
});
