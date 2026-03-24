import { parseEmail } from "./parser";
import { composeMessage } from "./compose";
import type { InboundEmail, ReplyMessage } from "./types";

/**
 * Build a typed InboundEmail from a CF ForwardableEmailMessage.
 * Shared between createEmailHandler() and createEmailRouter().
 */
export async function buildInboundEmail(
	message: ForwardableEmailMessage,
): Promise<InboundEmail> {
	const parsed = await parseEmail(message.raw);

	return {
		from: message.from,
		to: message.to,
		subject: parsed.subject,
		text: parsed.text,
		html: parsed.html,
		headers: message.headers,
		rawSize: message.rawSize,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		references: parsed.references,
		date: parsed.date,
		attachments: parsed.attachments,

		async forward(rcptTo: string, headers?: Headers) {
			await message.forward(rcptTo, headers);
		},

		async reply(replyMsg: ReplyMessage) {
			const composed = composeMessage({
				from: replyMsg.from,
				to: message.from,
				subject: replyMsg.subject ?? `Re: ${parsed.subject}`,
				text: replyMsg.text,
				html: replyMsg.html,
				headers: parsed.messageId
					? { "In-Reply-To": parsed.messageId }
					: undefined,
			});

			await message.reply({
				from: typeof replyMsg.from === "string" ? replyMsg.from : replyMsg.from.email,
				to: message.from,
				raw: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(composed.raw));
						controller.close();
					},
				}),
			} as any);
		},

		setReject(reason: string) {
			message.setReject(reason);
		},
	};
}
