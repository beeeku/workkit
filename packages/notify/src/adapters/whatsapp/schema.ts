/**
 * D1 schema for `@workkit/notify/whatsapp`. Run alongside `ALL_MIGRATIONS`
 * from `@workkit/notify` and `INAPP_MIGRATION_SQL` from
 * `@workkit/notify/inapp`.
 */

export const WA_OPTIN_MIGRATION_SQL: string = `
CREATE TABLE IF NOT EXISTS wa_optin_proofs (
	user_id TEXT NOT NULL,
	phone_e164 TEXT NOT NULL,        -- ciphertext if cipher hook is wired
	opted_in_at INTEGER NOT NULL,
	method TEXT NOT NULL,            -- 'checkbox-signup' | 'click-to-chat' | 'ivr' | …
	source_url TEXT,
	ip_hash TEXT,
	user_agent TEXT,
	revoked_at INTEGER,
	revoke_reason TEXT,
	PRIMARY KEY (user_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_optin_phone ON wa_optin_proofs(phone_e164);
`.trim();

export const WA_MEDIA_CACHE_MIGRATION_SQL: string = `
CREATE TABLE IF NOT EXISTS wa_media_cache (
	cache_key TEXT PRIMARY KEY,      -- 'r2://<r2Key>:<etag>'
	provider TEXT NOT NULL,          -- 'meta' | 'twilio' | 'gupshup'
	media_id TEXT NOT NULL,
	mime_type TEXT,
	bytes INTEGER,
	uploaded_at INTEGER NOT NULL,
	expires_at INTEGER               -- nullable; populated by adapter (default 30d for Meta)
);
CREATE INDEX IF NOT EXISTS idx_wa_media_expires ON wa_media_cache(expires_at);
`.trim();

export const WA_INBOUND_LOG_MIGRATION_SQL: string = `
CREATE TABLE IF NOT EXISTS wa_inbound_log (
	user_id TEXT PRIMARY KEY,
	last_inbound_at INTEGER NOT NULL,
	last_text TEXT
);
`.trim();

export const WA_ALL_MIGRATIONS: ReadonlyArray<string> = [
	WA_OPTIN_MIGRATION_SQL,
	WA_MEDIA_CACHE_MIGRATION_SQL,
	WA_INBOUND_LOG_MIGRATION_SQL,
];
