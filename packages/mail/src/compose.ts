import { Mailbox, createMimeMessage } from "mimetext";
import type { MailboxAddrObject } from "mimetext";
import type { ComposeOptions, ComposedMessage, MailAddress } from "./types";

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

function toEmailString(addr: string | MailAddress): string {
	return typeof addr === "string" ? addr : addr.email;
}

function toMailboxInput(addr: string | MailAddress): string | MailboxAddrObject {
	if (typeof addr === "string") {
		return addr;
	}
	return { addr: addr.email, name: addr.name };
}

function toArray<T>(value: T | T[] | undefined): T[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

/** Compose a MIME message from structured options. Returns raw MIME string + envelope addresses. */
export function composeMessage(options: ComposeOptions): ComposedMessage {
	const msg = createMimeMessage();

	// Sender
	msg.setSender(toMailboxInput(options.from));

	// Recipients
	const toAddrs = toArray(options.to);
	msg.setTo(toAddrs);

	// CC
	const ccAddrs = toArray(options.cc);
	if (ccAddrs.length > 0) {
		msg.setCc(ccAddrs);
	}

	// BCC
	const bccAddrs = toArray(options.bcc);
	if (bccAddrs.length > 0) {
		msg.setBcc(bccAddrs);
	}

	// Reply-To
	if (options.replyTo) {
		const replyMailbox = new Mailbox(toMailboxInput(options.replyTo));
		msg.setHeader("Reply-To", replyMailbox);
	}

	// Subject
	msg.setSubject(options.subject);

	// Body
	if (options.text) {
		msg.addMessage({ contentType: "text/plain", data: options.text });
	}
	if (options.html) {
		msg.addMessage({ contentType: "text/html", data: options.html });
	}

	// Custom headers
	if (options.headers) {
		for (const [key, value] of Object.entries(options.headers)) {
			msg.setHeader(key, value);
		}
	}

	// Attachments
	if (options.attachments) {
		for (const att of options.attachments) {
			const data =
				att.content instanceof ArrayBuffer || att.content instanceof Uint8Array
					? uint8ArrayToBase64(
							new Uint8Array(att.content instanceof ArrayBuffer ? att.content : att.content.buffer),
						)
					: att.content;

			if (att.inline && att.contentId) {
				msg.addAttachment({
					inline: true,
					filename: att.filename,
					contentType: att.contentType,
					data,
					headers: { "Content-ID": att.contentId },
				});
			} else {
				msg.addAttachment({
					filename: att.filename,
					contentType: att.contentType,
					data,
				});
			}
		}
	}

	return {
		raw: msg.asRaw(),
		from: toEmailString(options.from),
		to: toAddrs[0] ?? "",
	};
}
