/**
 * D1 schema additions for `@workkit/notify/inapp`. Run once during your
 * migration setup, alongside `ALL_MIGRATIONS` from `@workkit/notify`.
 */

export const INAPP_MIGRATION_SQL: string = `
CREATE TABLE IF NOT EXISTS in_app_notifications (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	notification_id TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	deep_link TEXT,
	metadata TEXT,                 -- JSON, optional
	created_at INTEGER NOT NULL,
	read_at INTEGER,
	dismissed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inapp_user_unread ON in_app_notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inapp_user_created ON in_app_notifications(user_id, created_at DESC);
`.trim();
