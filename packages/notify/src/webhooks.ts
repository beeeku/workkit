import type { AdapterRegistry } from "./adapters";
import { updateDeliveryStatus } from "./records";
import type { ChannelName, NotifyD1, WebhookEvent } from "./types";

export interface WebhookHandlerOptions {
	channel: ChannelName;
	db: NotifyD1;
	registry: AdapterRegistry;
	secret?: string;
	/** Tolerated webhook age in ms — older events rejected. Default 5 min. */
	maxAgeMs?: number;
}

/**
 * Framework-agnostic webhook handler. Returns `(req: Request) => Promise<Response>`.
 * - 404 if no adapter for channel.
 * - 401 if signature verification fails.
 * - 422 if body is unparseable.
 * - 200 with `{ accepted, rejected }` count otherwise.
 */
export function webhookHandler(opts: WebhookHandlerOptions): (req: Request) => Promise<Response> {
	const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
	return async (req) => {
		const adapter = opts.registry.get(opts.channel);
		if (!adapter) return jsonResponse(404, { error: `no adapter for channel "${opts.channel}"` });
		if (adapter.verifySignature) {
			if (!opts.secret) return jsonResponse(500, { error: "secret missing for verifySignature" });
			const ok = await adapter.verifySignature(req.clone(), opts.secret);
			if (!ok) return jsonResponse(401, { error: "invalid signature" });
		}
		if (!adapter.parseWebhook)
			return jsonResponse(404, { error: "adapter does not parse webhooks" });

		let events: WebhookEvent[];
		try {
			events = await adapter.parseWebhook(req);
		} catch (err) {
			return jsonResponse(422, { error: err instanceof Error ? err.message : "parse failed" });
		}

		let accepted = 0;
		let rejected = 0;
		const now = Date.now();
		for (const e of events) {
			if (now - e.at > maxAgeMs) {
				rejected += 1;
				continue;
			}
			// Bind to the handler's channel, not the event's. A bug or hostile
			// adapter parser can't update deliveries on a different channel
			// even if `provider_id` collides.
			if (e.channel && e.channel !== opts.channel) {
				rejected += 1;
				continue;
			}
			const found = await opts.db
				.prepare("SELECT id FROM notification_deliveries WHERE provider_id = ? AND channel = ?")
				.bind(e.providerId, opts.channel)
				.first<{ id: string }>();
			if (!found) {
				rejected += 1;
				continue;
			}
			// Idempotent state transition: don't downgrade a 'bounced'/'failed' to 'delivered'.
			const current = await opts.db
				.prepare("SELECT status FROM notification_deliveries WHERE id = ?")
				.bind(found.id)
				.first<{ status: string }>();
			if (current && (current.status === "bounced" || current.status === "failed")) {
				rejected += 1;
				continue;
			}
			await updateDeliveryStatus(opts.db, found.id, e.status, {
				deliveredAt: e.status === "delivered" ? e.at : undefined,
			});
			accepted += 1;
		}
		return jsonResponse(200, { accepted, rejected });
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
