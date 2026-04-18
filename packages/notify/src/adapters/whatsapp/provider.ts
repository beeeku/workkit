import type { WebhookEvent } from "../../types";

export type WhatsAppCategory = "marketing" | "transactional" | "authentication";

export interface WaTemplateRef {
	name: string;
	language: string; // BCP-47, e.g., "en", "hi", "en_US"
	variables?: ReadonlyArray<string>;
	category?: WhatsAppCategory;
}

export interface WaMediaRef {
	mediaId: string;
	mimeType?: string;
}

export interface WaSendArgs {
	toE164: string;
	template?: WaTemplateRef;
	sessionText?: string;
	media?: WaMediaRef;
}

export interface WaSendResult {
	providerId: string;
}

export interface WaUploadArgs {
	bytes: Uint8Array;
	mimeType: string;
	filename?: string;
}

/**
 * Inbound message events parsed from a webhook. The adapter inspects the
 * text body for STOP keywords and the type for quality-rating updates.
 */
export interface WaInboundMessage {
	from: string;
	text?: string;
	at: number;
	raw?: unknown;
}

export interface WaQualityAlert {
	level: "low" | "medium" | "high" | "flagged";
	at: number;
	raw?: unknown;
}

/**
 * Provider events: a union of delivery `WebhookEvent`s (mapped to the
 * notify-core webhook shape), inbound messages, and account-quality
 * alerts. The adapter routes each variant.
 */
export type WaProviderEvent =
	| { kind: "delivery"; event: WebhookEvent }
	| { kind: "inbound"; message: WaInboundMessage }
	| { kind: "quality"; alert: WaQualityAlert };

/**
 * Pluggable provider interface. `metaWaProvider` is the reference impl;
 * `twilioWaProvider` and `gupshupWaProvider` are stubs.
 */
export interface WaProvider {
	readonly name: "meta" | "twilio" | "gupshup";
	send(args: WaSendArgs): Promise<WaSendResult>;
	uploadMedia(args: WaUploadArgs): Promise<WaMediaRef>;
	parseWebhook(req: Request): Promise<WaProviderEvent[]>;
	verifySignature(req: Request, secret: string): Promise<boolean>;
	/**
	 * Meta requires a one-shot `GET ?hub.mode=subscribe&hub.challenge=…&hub.verify_token=…`
	 * handshake on webhook setup. Providers that don't need this can return null.
	 */
	handleVerificationChallenge(req: Request, verifyToken: string): Response | null;
}
