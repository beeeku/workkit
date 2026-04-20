import type { InboundEmail, ParsedAttachment } from "@workkit/mail";
import { parseEmail } from "@workkit/mail";
import { describe, expect, it, vi } from "vitest";
import { createBounceRoute } from "../src/adapters/email/bounce-route";

const CRLF = "\r\n";

async function inboundFromRaw(raw: string): Promise<InboundEmail> {
	const parsed = await parseEmail(raw);
	return {
		from: parsed.from,
		to: parsed.to,
		subject: parsed.subject,
		text: parsed.text,
		html: parsed.html,
		headers: new Headers(),
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

function dsn(opts: { status: string; recipient: string; action?: string }): string {
	const boundary = "BoundaryDSN";
	return [
		"From: postmaster@example.com",
		"To: bounces@yourdomain.com",
		"Subject: Delivery Status",
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
		`Final-Recipient: rfc822; ${opts.recipient}`,
		`Action: ${opts.action ?? "failed"}`,
		`Status: ${opts.status}`,
		`--${boundary}--`,
	].join(CRLF);
}

function plain(): string {
	return [
		"From: friend@example.com",
		"To: bounces@yourdomain.com",
		"Subject: hi",
		"MIME-Version: 1.0",
		"Content-Type: text/plain",
		"",
		"misrouted reply",
	].join(CRLF);
}

describe("createBounceRoute()", () => {
	it("hard bounce → optOutHook called with 'hard-bounce' reason", async () => {
		const optOutHook = vi.fn().mockResolvedValue(undefined);
		const handler = createBounceRoute({ optOutHook });

		await handler(await inboundFromRaw(dsn({ status: "5.1.1", recipient: "gone@example.com" })));

		expect(optOutHook).toHaveBeenCalledTimes(1);
		expect(optOutHook).toHaveBeenCalledWith("gone@example.com", "email", null, "hard-bounce");
	});

	it("soft bounce → optOutHook NOT called", async () => {
		const optOutHook = vi.fn().mockResolvedValue(undefined);
		const handler = createBounceRoute({ optOutHook });

		await handler(await inboundFromRaw(dsn({ status: "4.2.2", recipient: "full@example.com" })));

		expect(optOutHook).not.toHaveBeenCalled();
	});

	it("non-DSN email → onNonBounce invoked", async () => {
		const optOutHook = vi.fn();
		const onNonBounce = vi.fn();
		const handler = createBounceRoute({ optOutHook, onNonBounce });

		const email = await inboundFromRaw(plain());
		await handler(email);

		expect(optOutHook).not.toHaveBeenCalled();
		expect(onNonBounce).toHaveBeenCalledWith(email);
	});

	it("non-DSN email + no onNonBounce → silent no-op (no throw)", async () => {
		const optOutHook = vi.fn();
		const handler = createBounceRoute({ optOutHook });

		await expect(handler(await inboundFromRaw(plain()))).resolves.toBeUndefined();
		expect(optOutHook).not.toHaveBeenCalled();
	});

	it("delayed (non-failed Action) → treated as non-bounce; onNonBounce fires", async () => {
		const optOutHook = vi.fn();
		const onNonBounce = vi.fn();
		const handler = createBounceRoute({ optOutHook, onNonBounce });

		await handler(
			await inboundFromRaw(
				dsn({ status: "4.4.7", recipient: "user@example.com", action: "delayed" }),
			),
		);

		expect(optOutHook).not.toHaveBeenCalled();
		expect(onNonBounce).toHaveBeenCalledTimes(1);
	});

	it("hook throws → error propagates so the MTA can retry", async () => {
		const optOutHook = vi.fn().mockRejectedValue(new Error("D1 down"));
		const handler = createBounceRoute({ optOutHook });

		await expect(
			handler(await inboundFromRaw(dsn({ status: "5.7.1", recipient: "spammed@example.com" }))),
		).rejects.toThrow("D1 down");
	});
});
