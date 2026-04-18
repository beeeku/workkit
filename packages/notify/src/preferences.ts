import type { ChannelName, NotificationPreferences, NotifyD1, QuietHours } from "./types";

interface PrefRow {
	channels: string;
	quiet_hours_start: string | null;
	quiet_hours_end: string | null;
	timezone: string | null;
}

export async function readPreferences(
	db: NotifyD1,
	userId: string,
	notificationId: string,
): Promise<NotificationPreferences | null> {
	const row = await db
		.prepare(
			"SELECT channels, quiet_hours_start, quiet_hours_end, timezone FROM notification_prefs WHERE user_id = ? AND notification_id = ?",
		)
		.bind(userId, notificationId)
		.first<PrefRow>();
	if (!row) return null;
	let channels: ChannelName[] = [];
	try {
		const parsed = JSON.parse(row.channels);
		if (Array.isArray(parsed)) channels = parsed.filter((s): s is string => typeof s === "string");
	} catch {
		channels = [];
	}
	const quietHours: QuietHours | undefined =
		row.quiet_hours_start && row.quiet_hours_end && row.timezone
			? {
					start: row.quiet_hours_start,
					end: row.quiet_hours_end,
					timezone: row.timezone,
				}
			: undefined;
	return { channels, quietHours };
}

export async function upsertPreferences(
	db: NotifyD1,
	userId: string,
	notificationId: string,
	prefs: NotificationPreferences,
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO notification_prefs(user_id, notification_id, channels, quiet_hours_start, quiet_hours_end, timezone) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, notification_id) DO UPDATE SET channels = excluded.channels, quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end, timezone = excluded.timezone",
		)
		.bind(
			userId,
			notificationId,
			JSON.stringify(prefs.channels),
			prefs.quietHours?.start ?? null,
			prefs.quietHours?.end ?? null,
			prefs.quietHours?.timezone ?? null,
		)
		.run();
}
