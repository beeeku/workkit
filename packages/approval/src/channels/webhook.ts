import type { ChannelAdapter, ChannelErrorInfo, NotificationPayload } from "../types";

interface WebhookChannelConfig {
	url: string;
	signingSecret?: string;
	headers?: Record<string, string>;
	timeout?: number;
}

export function createWebhookChannel(config: WebhookChannelConfig): ChannelAdapter {
	return {
		name: "webhook",
		async send(
			notification: NotificationPayload,
		): Promise<{ ok: true } | { ok: false; error: ChannelErrorInfo }> {
			try {
				const body = JSON.stringify(notification);
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
					...config.headers,
				};

				// TODO: HMAC signing when signingSecret is configured (v0.2.0)

				const response = await fetch(config.url, {
					method: "POST",
					headers,
					body,
					signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
				});

				if (response.ok) {
					return { ok: true };
				}

				return {
					ok: false,
					error: {
						channel: "webhook",
						message: `HTTP ${response.status}: ${response.statusText}`,
						retryable: response.status >= 500,
					},
				};
			} catch (error: any) {
				return {
					ok: false,
					error: {
						channel: "webhook",
						message: error.message ?? "Unknown error",
						retryable: true,
					},
				};
			}
		},
	};
}
