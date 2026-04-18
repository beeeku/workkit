/**
 * D1 schema for @workkit/notify. Run these once during your migration setup.
 * Stored as plain strings so consumers can pipe them into their migration
 * runner of choice (`@workkit/d1` or `wrangler d1 migrations`).
 */

export const NOTIFICATION_PREFS_SQL: string = `
CREATE TABLE IF NOT EXISTS notification_prefs (
	user_id TEXT NOT NULL,
	notification_id TEXT NOT NULL,
	channels TEXT NOT NULL,         -- JSON array of channel names, ordered
	quiet_hours_start TEXT,         -- "HH:mm"
	quiet_hours_end TEXT,           -- "HH:mm"
	timezone TEXT,                  -- IANA
	PRIMARY KEY (user_id, notification_id)
);
`.trim();

export const NOTIFICATION_OPTOUTS_SQL: string = `
CREATE TABLE IF NOT EXISTS notification_optouts (
	user_id TEXT NOT NULL,
	channel TEXT NOT NULL,
	notification_id TEXT,           -- NULL = global opt-out for the channel
	opted_out_at INTEGER NOT NULL,
	reason TEXT,
	PRIMARY KEY (user_id, channel, notification_id)
);
`.trim();

export const NOTIFICATION_DELIVERIES_SQL: string = `
CREATE TABLE IF NOT EXISTS notification_deliveries (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	notification_id TEXT NOT NULL,
	channel TEXT NOT NULL,
	status TEXT NOT NULL,           -- queued|sent|delivered|read|failed|bounced|skipped|duplicate
	idempotency_key TEXT NOT NULL,
	payload TEXT,                   -- JSON; redacted in test mode
	provider_id TEXT,
	error TEXT,                     -- JSON or message
	attempted_at INTEGER NOT NULL,
	delivered_at INTEGER,
	UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notification_deliveries(user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_status_attempted ON notification_deliveries(status, attempted_at DESC);
`.trim();

export const ALL_MIGRATIONS: ReadonlyArray<string> = [
	NOTIFICATION_PREFS_SQL,
	NOTIFICATION_OPTOUTS_SQL,
	NOTIFICATION_DELIVERIES_SQL,
];
