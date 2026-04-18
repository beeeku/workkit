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
	await deps.db
		.prepare(
			"INSERT INTO wa_inbound_log(user_id, last_inbound_at, last_text) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET last_inbound_at = excluded.last_inbound_at, last_text = excluded.last_text",
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

export const SESSION_WINDOW_MS = TWENTY_FOUR_HOURS_MS;
