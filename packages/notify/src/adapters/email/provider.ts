import type { AdapterSendResult, WebhookEvent } from "../../types";

/** A single attachment passed from the adapter to the provider — raw bytes. */
export interface EmailAttachmentWire {
	readonly filename: string;
	readonly content: Uint8Array;
	readonly contentType: string;
}

/** Arguments the adapter passes to `provider.send` after template rendering + attachment loading. */
export interface EmailProviderSendArgs {
	readonly to: string;
	readonly subject: string;
	readonly html: string;
	readonly text: string;
	readonly attachments?: readonly EmailAttachmentWire[];
	readonly headers?: Readonly<Record<string, string>>;
	readonly notificationId: string;
	readonly deliveryId: string;
}

/**
 * Pluggable email provider. `cloudflareEmailProvider` is the default;
 * `resendEmailProvider` is the first-class alternative. Mirrors the
 * `WaProvider` shape (`adapters/whatsapp/provider.ts`) minus
 * `handleVerificationChallenge` (email has no such handshake).
 *
 * Contract: `send` MUST return `AdapterSendResult` and MUST NOT throw —
 * providers that delegate to libraries which throw (e.g., `@workkit/mail`)
 * must catch and convert.
 */
export interface EmailProvider {
	readonly name: "cloudflare" | "resend";
	send(args: EmailProviderSendArgs): Promise<AdapterSendResult>;
	parseWebhook?(req: Request): Promise<WebhookEvent[]>;
	verifySignature?(req: Request, secret: string): Promise<boolean>;
}
