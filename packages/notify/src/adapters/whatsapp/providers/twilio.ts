import type { WaProvider } from "../provider";

export interface TwilioWaProviderOptions {
	accountSid: string;
	authToken: string;
	fromNumber: string;
	apiUrl?: string;
}

const NOT_IMPLEMENTED =
	"twilioWaProvider is not implemented yet — see github.com/beeeku/workkit/issues/29 (community contribution welcome)";

/**
 * Stub. The provider interface is fixed so a real implementation can drop
 * in without touching the adapter or any caller code.
 */
export function twilioWaProvider(_options: TwilioWaProviderOptions): WaProvider {
	return {
		name: "twilio",
		async send() {
			throw new Error(NOT_IMPLEMENTED);
		},
		async uploadMedia() {
			throw new Error(NOT_IMPLEMENTED);
		},
		async parseWebhook() {
			throw new Error(NOT_IMPLEMENTED);
		},
		async verifySignature() {
			throw new Error(NOT_IMPLEMENTED);
		},
		handleVerificationChallenge() {
			return null;
		},
	};
}
