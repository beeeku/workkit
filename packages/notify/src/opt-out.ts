import type { ChannelName, NotifyD1 } from "./types";

export interface OptOutRecord {
	channel: ChannelName;
	notificationId: string | null; // null = global opt-out for the channel
	optedOutAt: number;
	reason?: string;
}

/**
 * Returns true when the user is opted out of (channel, notificationId) — either
 * via a notification-specific row OR a global opt-out (notificationId IS NULL).
 */
export async function isOptedOut(
	db: NotifyD1,
	userId: string,
	channel: ChannelName,
	notificationId: string,
): Promise<boolean> {
	const row = await db
		.prepare(
			"SELECT 1 AS hit FROM notification_optouts WHERE user_id = ? AND channel = ? AND (notification_id = ? OR notification_id IS NULL) LIMIT 1",
		)
		.bind(userId, channel, notificationId)
		.first<{ hit: number }>();
	return row !== null;
}

export async function optOut(
	db: NotifyD1,
	userId: string,
	channel: ChannelName,
	notificationId: string | null,
	reason?: string,
	now: number = Date.now(),
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO notification_optouts(user_id, channel, notification_id, opted_out_at, reason) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, channel, notification_id) DO UPDATE SET opted_out_at = excluded.opted_out_at, reason = excluded.reason",
		)
		.bind(userId, channel, notificationId, now, reason ?? null)
		.run();
}

export async function listOptOuts(db: NotifyD1, userId: string): Promise<OptOutRecord[]> {
	const out = await db
		.prepare(
			"SELECT channel, notification_id, opted_out_at, reason FROM notification_optouts WHERE user_id = ?",
		)
		.bind(userId)
		.all<{
			channel: string;
			notification_id: string | null;
			opted_out_at: number;
			reason: string | null;
		}>();
	return (out.results ?? []).map((r) => ({
		channel: r.channel,
		notificationId: r.notification_id,
		optedOutAt: r.opted_out_at,
		reason: r.reason ?? undefined,
	}));
}
