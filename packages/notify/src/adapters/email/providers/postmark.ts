import type { AdapterSendResult, WebhookEvent } from "../../../types";
import type { EmailProvider } from "../provider";

export interface PostmarkEmailProviderOptions {
	/** Server token from a Postmark "Server" — narrower scope than the account token. */
	readonly serverToken: string;
	/** Default `From:` address — must be a verified sender signature in Postmark. */
	readonly from: string;
	/** Optional. Override the API host (rarely needed). */
	readonly apiUrl?: string;
}

const NOT_IMPLEMENTED =
	"postmarkEmailProvider is not implemented yet — see github.com/beeeku/workkit/issues/57 (community contribution welcome)";

/**
 * Stub for Postmark. The provider interface is fixed (matches the
 * existing `cloudflareEmailProvider` / `resendEmailProvider`), so a real
 * `POST /email` + webhook implementation can drop in without touching
 * the adapter or any caller code.
 *
 * Community implementation welcome — see
 * [#57](https://github.com/beeeku/workkit/issues/57).
 */
export function postmarkEmailProvider(_options: PostmarkEmailProviderOptions): EmailProvider {
	return {
		name: "postmark",
		async send(_args): Promise<AdapterSendResult> {
			throw new Error(NOT_IMPLEMENTED);
		},
		async parseWebhook(_req): Promise<WebhookEvent[]> {
			throw new Error(NOT_IMPLEMENTED);
		},
		async verifySignature(_req, _secret): Promise<boolean> {
			throw new Error(NOT_IMPLEMENTED);
		},
	};
}
