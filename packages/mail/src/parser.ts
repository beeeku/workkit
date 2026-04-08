import PostalMime from "postal-mime";
import type { ParsedAttachment } from "./types";

/** Parsed email — flat structure extracted via postal-mime */
export interface ParsedEmail {
	readonly from: string;
	readonly to: string;
	readonly subject: string;
	readonly text?: string;
	readonly html?: string;
	readonly messageId?: string;
	readonly inReplyTo?: string;
	readonly references?: string;
	readonly date?: string;
	readonly attachments: readonly ParsedAttachment[];
}

/**
 * Parse a raw email message into a structured object.
 * Accepts a raw MIME string, ArrayBuffer, Uint8Array, or ReadableStream.
 */
export async function parseEmail(
	raw: string | ArrayBuffer | Uint8Array | ReadableStream,
): Promise<ParsedEmail> {
	let input: string | ArrayBuffer;

	if (raw instanceof ReadableStream) {
		const response = new Response(raw);
		input = await response.arrayBuffer();
	} else if (raw instanceof Uint8Array) {
		input = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
	} else {
		input = raw;
	}

	const parsed = await PostalMime.parse(input);

	const fromAddr = parsed.from?.address ?? (parsed.from as unknown as string) ?? "";
	const toAddrs = parsed.to ?? [];
	const toStr = toAddrs.map((a: { address?: string }) => a.address ?? "").join(", ");

	return {
		from: fromAddr,
		to: toStr,
		subject: parsed.subject ?? "",
		text: parsed.text?.trimEnd() ?? undefined,
		html: parsed.html ?? undefined,
		messageId: parsed.messageId ?? undefined,
		inReplyTo: parsed.inReplyTo ?? undefined,
		references: parsed.references ?? undefined,
		date: parsed.date ?? undefined,
		attachments: (parsed.attachments ?? []).map((att) => ({
			filename: att.filename ?? undefined,
			contentType: att.mimeType,
			content:
				att.content instanceof Uint8Array
					? (att.content.buffer.slice(
							att.content.byteOffset,
							att.content.byteOffset + att.content.byteLength,
						) as ArrayBuffer)
					: att.content,
			contentId: att.contentId ?? undefined,
			disposition: att.disposition as "attachment" | "inline" | undefined,
		})),
	};
}
