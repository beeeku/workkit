import { ConfigError, ValidationError } from "@workkit/errors";

export class OptInRequiredError extends ValidationError {
	constructor(userId: string, channel = "whatsapp") {
		super(`opt-in proof required before sending on ${channel} for user ${userId}`, [
			{ path: ["optIn", userId], message: "missing or revoked opt-in" },
		]);
	}
}

export class TemplateNotApprovedError extends ConfigError {
	constructor(reason: string) {
		super(`WhatsApp template rejected: ${reason}`);
	}
}

export class WhatsAppPhoneFormatError extends ValidationError {
	constructor(value: string) {
		super(`WhatsApp recipient is not E.164: ${JSON.stringify(value)}`, [
			{ path: ["address"], message: "expected leading + and 8–15 digits" },
		]);
	}
}

export class WhatsAppWebhookSignatureError extends ValidationError {
	constructor(reason: string) {
		super(`WhatsApp webhook signature verification failed: ${reason}`, [
			{ path: ["webhook"], message: reason },
		]);
	}
}

export class MarketingPausedError extends ValidationError {
	constructor(notificationId: string) {
		super(`marketing sends are paused; refused to send ${notificationId}`, [
			{ path: ["category"], message: "marketing-paused" },
		]);
	}
}
