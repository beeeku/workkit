import { ConfigError, ValidationError } from "@workkit/errors";

export class FromDomainError extends ConfigError {
	constructor(value: string) {
		super(
			`emailAdapter: 'from' must be either "name@domain" or "Name <name@domain>" — got: ${JSON.stringify(value)}`,
		);
	}
}

export class AttachmentTooLargeError extends ValidationError {
	constructor(totalBytes: number, capBytes: number) {
		super(`email payload exceeds attachment cap (${totalBytes} > ${capBytes} bytes)`, [
			{ path: ["attachments"], message: `total ${totalBytes} bytes; cap ${capBytes}` },
		]);
	}
}

export type EmailProviderName = "resend" | "cloudflare" | (string & {});

export class WebhookSignatureError extends ValidationError {
	constructor(provider: EmailProviderName, reason: string) {
		super(`${provider} webhook signature verification failed: ${reason}`, [
			{ path: ["webhook"], message: reason },
		]);
	}
}

export class ProviderMissingError extends ConfigError {
	constructor() {
		super(
			"emailAdapter: `provider` is required — pass cloudflareEmailProvider() or resendEmailProvider()",
		);
	}
}
