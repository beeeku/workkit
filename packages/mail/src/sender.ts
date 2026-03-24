import { BindingNotFoundError } from "@workkit/errors";
import { composeMessage } from "./compose";
import { DeliveryError, InvalidAddressError } from "./errors";
import type { MailMessage, MailOptions, SendResult, TypedMailClient } from "./types";
import { validateAddress } from "./validation";

function toArray(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function resolveFrom(message: MailMessage, options?: MailOptions): string {
	const from = message.from ?? options?.defaultFrom;
	if (!from) {
		throw new InvalidAddressError("(empty)", {
			context: { reason: "No 'from' address provided and no defaultFrom configured" },
		});
	}
	const addr = typeof from === "string" ? from : from.email;
	return validateAddress(addr);
}

/**
 * Create a typed mail client from a Cloudflare SendEmail binding.
 */
export function mail(binding: SendEmail, options?: MailOptions): TypedMailClient {
	if (binding == null) {
		throw new BindingNotFoundError("SendEmail binding is null or undefined", {
			context: { bindingType: "SendEmail" },
		});
	}

	return {
		async send(message: MailMessage): Promise<SendResult> {
			// Validate from
			const from = resolveFrom(message, options);

			// Validate recipients
			const toAddrs = toArray(message.to);
			for (const addr of toAddrs) {
				validateAddress(addr);
			}
			for (const addr of toArray(message.cc)) {
				validateAddress(addr);
			}
			for (const addr of toArray(message.bcc)) {
				validateAddress(addr);
			}

			// Compose MIME
			const composed = composeMessage({
				from: message.from ?? options?.defaultFrom ?? from,
				to: message.to,
				subject: message.subject,
				cc: message.cc,
				bcc: message.bcc,
				replyTo: message.replyTo,
				text: message.text,
				html: message.html,
				attachments: message.attachments,
				headers: message.headers,
			});

			// Send via binding — in real CF Workers this uses EmailMessage from cloudflare:email
			// but that module only exists in the CF runtime, so we call binding.send() directly
			try {
				await binding.send({ from: composed.from, to: composed.to, raw: composed.raw } as any);
			} catch (error) {
				throw new DeliveryError(error instanceof Error ? error.message : "Email delivery failed", {
					cause: error,
				});
			}

			// Extract message-id from composed raw
			const messageIdMatch = composed.raw.match(/Message-ID:\s*(<[^>]+>)/i);
			return {
				messageId: messageIdMatch?.[1] ?? `<${crypto.randomUUID()}@workkit>`,
			};
		},

		get raw(): SendEmail {
			return binding;
		},
	};
}
