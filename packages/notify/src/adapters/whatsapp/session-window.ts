import type { NotifyD1 } from "../../types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface SessionWindowDeps {
	db: NotifyD1;
	now?: () => number;
}

/**
 * Record an inbound message — used to determine whether the recipient is
 * inside the WhatsApp 24h customer-service window.
 */
export async function recordInbound(
	deps: SessionWindowDeps,
	args: { userId: string; at?: number; text?: string },
): Promise<void> {
	const at = args.at ?? deps.now?.() ?? Date.now();
	// Use MAX(existing, incoming) so out-of-order webhook deliveries can never
	// move `last_inbound_at` backwards (which would prematurely close the 24h
	// session window). `last_text` only updates when the timestamp advances.
	await deps.db
		.prepare(
			"INSERT INTO wa_inbound_log(user_id, last_inbound_at, last_text) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET last_inbound_at = CASE WHEN excluded.last_inbound_at > wa_inbound_log.last_inbound_at THEN excluded.last_inbound_at ELSE wa_inbound_log.last_inbound_at END, last_text = CASE WHEN excluded.last_inbound_at > wa_inbound_log.last_inbound_at THEN excluded.last_text ELSE wa_inbound_log.last_text END",
		)
		.bind(args.userId, at, args.text ?? null)
		.run();
}

/**
 * True iff the most recent inbound message from `userId` is within the WA
 * 24h window. Returns false when no inbound has been recorded.
 */
export async function withinSessionWindow(
	deps: SessionWindowDeps,
	userId: string,
): Promise<boolean> {
	const row = await deps.db
		.prepare("SELECT last_inbound_at FROM wa_inbound_log WHERE user_id = ?")
		.bind(userId)
		.first<{ last_inbound_at: number }>();
	if (!row) return false;
	const now = deps.now?.() ?? Date.now();
	return now - row.last_inbound_at < TWENTY_FOUR_HOURS_MS;
}

export const SESSION_WINDOW_MS: number = TWENTY_FOUR_HOURS_MS;
