import type { WaProvider } from "../provider";

export interface GupshupWaProviderOptions {
	apiKey: string;
	appName: string;
	apiUrl?: string;
}

const NOT_IMPLEMENTED =
	"gupshupWaProvider is not implemented yet — see github.com/beeeku/workkit/issues/29 (community contribution welcome)";

/** Stub. Provider interface is stable. */
export function gupshupWaProvider(_options: GupshupWaProviderOptions): WaProvider {
	return {
		name: "gupshup",
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
