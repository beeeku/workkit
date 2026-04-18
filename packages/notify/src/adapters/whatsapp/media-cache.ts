import type { NotifyD1 } from "../../types";

export interface MediaCacheDeps {
	db: NotifyD1;
	now?: () => number;
}

export interface CachedMedia {
	mediaId: string;
	mimeType?: string;
	bytes?: number;
	uploadedAt: number;
	expiresAt?: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches Meta retention

export function cacheKey(provider: string, r2Key: string, etag: string): string {
	return `${provider}://${r2Key}:${etag}`;
}

export async function getCached(deps: MediaCacheDeps, key: string): Promise<CachedMedia | null> {
	const row = await deps.db
		.prepare(
			"SELECT media_id, mime_type, bytes, uploaded_at, expires_at FROM wa_media_cache WHERE cache_key = ?",
		)
		.bind(key)
		.first<{
			media_id: string;
			mime_type: string | null;
			bytes: number | null;
			uploaded_at: number;
			expires_at: number | null;
		}>();
	if (!row) return null;
	const now = deps.now?.() ?? Date.now();
	if (row.expires_at !== null && row.expires_at < now) return null;
	return {
		mediaId: row.media_id,
		mimeType: row.mime_type ?? undefined,
		bytes: row.bytes ?? undefined,
		uploadedAt: row.uploaded_at,
		expiresAt: row.expires_at ?? undefined,
	};
}

export async function putCached(
	deps: MediaCacheDeps,
	key: string,
	args: {
		provider: string;
		mediaId: string;
		mimeType?: string;
		bytes?: number;
		ttlMs?: number;
	},
): Promise<void> {
	const now = deps.now?.() ?? Date.now();
	const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
	await deps.db
		.prepare(
			"INSERT INTO wa_media_cache(cache_key, provider, media_id, mime_type, bytes, uploaded_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET media_id = excluded.media_id, mime_type = excluded.mime_type, bytes = excluded.bytes, uploaded_at = excluded.uploaded_at, expires_at = excluded.expires_at",
		)
		.bind(
			key,
			args.provider,
			args.mediaId,
			args.mimeType ?? null,
			args.bytes ?? null,
			now,
			now + ttl,
		)
		.run();
}

export async function purgeExpiredMedia(deps: MediaCacheDeps): Promise<{ deleted: number }> {
	const now = deps.now?.() ?? Date.now();
	const r = await deps.db
		.prepare("DELETE FROM wa_media_cache WHERE expires_at IS NOT NULL AND expires_at < ?")
		.bind(now)
		.run();
	return { deleted: r.meta?.changes ?? 0 };
}

export const DEFAULT_MEDIA_TTL_MS = DEFAULT_TTL_MS;
