import type { Adapter, AdapterSendArgs, AdapterSendResult, NotifyD1 } from "../../types";
import { BodyTooLongError } from "./errors";
import { safeLink } from "./safe-link";
import type { SseRegistry } from "./sse";

export interface InAppPayload {
	[key: string]: unknown;
}

export interface InAppAdapterOptions {
	db: NotifyD1;
	registry?: SseRegistry;
	/** Maximum body length in characters. Default 2000. */
	maxBodyChars?: number;
	/** Allowed deep-link URL schemes. Default `["https:"]`. */
	allowedSchemes?: ReadonlyArray<string>;
}

const DEFAULT_BODY_CAP = 2000;

interface InAppTemplate {
	title?: (p: InAppPayload) => string;
	body?: (p: InAppPayload) => string;
	deepLink?: (p: InAppPayload) => string;
	metadata?: (p: InAppPayload) => Record<string, unknown>;
}

export function inAppAdapter(options: InAppAdapterOptions): Adapter<InAppPayload> {
	const cap = Math.max(1, options.maxBodyChars ?? DEFAULT_BODY_CAP);
	return {
		async send(args: AdapterSendArgs<InAppPayload>): Promise<AdapterSendResult> {
			const tpl = args.template as InAppTemplate;
			const title = tpl.title?.(args.payload) ?? "(no title)";
			const body = tpl.body?.(args.payload) ?? "";
			if (body.length > cap) {
				return { status: "failed", error: new BodyTooLongError(body.length, cap).message };
			}
			let deepLink: string | null = null;
			if (tpl.deepLink) {
				const raw = tpl.deepLink(args.payload);
				try {
					deepLink = safeLink(raw, { allowedSchemes: options.allowedSchemes });
				} catch (err) {
					return { status: "failed", error: err instanceof Error ? err.message : String(err) };
				}
			}
			const metadata = tpl.metadata?.(args.payload);

			const id = crypto.randomUUID();
			const now = Date.now();
			try {
				await options.db
					.prepare(
						"INSERT INTO in_app_notifications(id, user_id, notification_id, title, body, deep_link, metadata, created_at, read_at, dismissed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
					)
					.bind(
						id,
						args.userId,
						args.notificationId,
						title,
						body,
						deepLink,
						metadata ? JSON.stringify(metadata) : null,
						now,
						null,
						null,
					)
					.run();
			} catch (err) {
				return { status: "failed", error: err instanceof Error ? err.message : String(err) };
			}

			// Best-effort push to active SSE subscribers; never fails the send.
			if (options.registry) {
				const event = JSON.stringify({
					id,
					notificationId: args.notificationId,
					title,
					body,
					deepLink,
					createdAt: now,
				});
				try {
					options.registry.push(args.userId, event);
				} catch {
					// Drop on registry-side issues; row is durable in D1 already.
				}
			}

			return { status: "delivered", providerId: id };
		},
	};
}
