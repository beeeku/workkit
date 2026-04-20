import type { AdapterSendResult, WebhookEvent } from "../../../types";
import type { EmailProvider } from "../provider";

export interface SesEmailProviderOptions {
	/** AWS region, e.g. `"us-east-1"`. */
	readonly region: string;
	/** IAM access key id with `ses:SendRawEmail` (or `ses:SendEmail`) permission. */
	readonly accessKeyId: string;
	/** IAM secret access key paired with `accessKeyId`. */
	readonly secretAccessKey: string;
	/** Default `From:` address — must be a verified identity in SES. */
	readonly from: string;
	/** Optional. Override the API host (e.g. for VPC endpoints). */
	readonly apiUrl?: string;
}

const NOT_IMPLEMENTED =
	"sesEmailProvider is not implemented yet — see github.com/beeeku/workkit/issues/57 (community contribution welcome)";

/**
 * Stub for AWS SES. The provider interface is fixed (matches the existing
 * `cloudflareEmailProvider` / `resendEmailProvider`), so a real SigV4 +
 * `SendRawEmail` implementation can drop in without touching the adapter
 * or any caller code.
 *
 * Community implementation welcome — see
 * [#57](https://github.com/beeeku/workkit/issues/57).
 */
export function sesEmailProvider(_options: SesEmailProviderOptions): EmailProvider {
	return {
		name: "ses",
		async send(_args): Promise<AdapterSendResult> {
			throw new Error(NOT_IMPLEMENTED);
		},
		async parseWebhook(_req): Promise<WebhookEvent[]> {
			// SES delivery notifications come over SNS — when implemented,
			// this method should accept the SNS envelope and decode the
			// inner SES payload.
			throw new Error(NOT_IMPLEMENTED);
		},
		async verifySignature(_req, _secret): Promise<boolean> {
			throw new Error(NOT_IMPLEMENTED);
		},
	};
}
