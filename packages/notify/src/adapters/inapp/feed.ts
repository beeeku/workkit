import type { NotifyD1 } from "../../types";

export interface InAppNotificationRow {
	id: string;
	notificationId: string;
	title: string;
	body: string;
	deepLink: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: number;
	readAt: number | null;
	dismissedAt: number | null;
}

export interface FeedOptions {
	userId: string;
	cursor?: string | null;
	limit?: number;
	includeRead?: boolean;
	includeDismissed?: boolean;
}

export interface FeedPage {
	items: InAppNotificationRow[];
	nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Encode a `(created_at, id)` cursor as opaque base64. Decoded server-side;
 * malformed cursors yield an empty page (no 500).
 */
function encodeCursor(createdAt: number, id: string): string {
	return btoa(`${createdAt}:${id}`).replace(/=+$/, "");
}

function decodeCursor(cursor: string | null | undefined): { createdAt: number; id: string } | null {
	if (!cursor) return null;
	try {
		const padded = cursor + "=".repeat((4 - (cursor.length % 4)) % 4);
		const raw = atob(padded);
		const [tsStr, id] = raw.split(":", 2);
		const ts = Number(tsStr);
		if (!Number.isFinite(ts) || !id) return null;
		return { createdAt: ts, id };
	} catch {
		return null;
	}
}

interface RowShape {
	id: string;
	notification_id: string;
	title: string;
	body: string;
	deep_link: string | null;
	metadata: string | null;
	created_at: number;
	read_at: number | null;
	dismissed_at: number | null;
}

function mapRow(r: RowShape): InAppNotificationRow {
	let metadata: Record<string, unknown> | null = null;
	if (r.metadata) {
		try {
			metadata = JSON.parse(r.metadata) as Record<string, unknown>;
		} catch {
			metadata = null;
		}
	}
	return {
		id: r.id,
		notificationId: r.notification_id,
		title: r.title,
		body: r.body,
		deepLink: r.deep_link,
		metadata,
		createdAt: r.created_at,
		readAt: r.read_at,
		dismissedAt: r.dismissed_at,
	};
}

export async function feed(db: NotifyD1, opts: FeedOptions): Promise<FeedPage> {
	const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
	const cur = decodeCursor(opts.cursor);
	let where = "user_id = ?";
	const binds: unknown[] = [opts.userId];
	if (!opts.includeRead) where += " AND read_at IS NULL";
	if (!opts.includeDismissed) where += " AND dismissed_at IS NULL";
	if (cur) {
		where += " AND (created_at < ? OR (created_at = ? AND id < ?))";
		binds.push(cur.createdAt, cur.createdAt, cur.id);
	}
	// Fetch limit+1 to know whether there's a next page.
	const rows = await db
		.prepare(
			`SELECT id, notification_id, title, body, deep_link, metadata, created_at, read_at, dismissed_at FROM in_app_notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
		)
		.bind(...binds, limit + 1)
		.all<RowShape>();
	const all = (rows.results ?? []).map(mapRow);
	const items = all.slice(0, limit);
	const nextCursor =
		all.length > limit && items.length > 0
			? encodeCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
			: null;
	return { items, nextCursor };
}

export interface MarkReadOptions {
	userId: string;
	ids?: string[];
	markAll?: boolean;
}

export async function markRead(
	db: NotifyD1,
	opts: MarkReadOptions,
	now: number = Date.now(),
): Promise<{ updated: number }> {
	if (opts.markAll === true) {
		const r = await db
			.prepare("UPDATE in_app_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
			.bind(now, opts.userId)
			.run();
		return { updated: r.meta?.changes ?? 0 };
	}
	if (!opts.ids || opts.ids.length === 0) return { updated: 0 };
	let updated = 0;
	for (const id of opts.ids) {
		// Ownership check is enforced via WHERE user_id = ? AND id = ?.
		const r = await db
			.prepare(
				"UPDATE in_app_notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
			)
			.bind(now, id, opts.userId)
			.run();
		updated += r.meta?.changes ?? 0;
	}
	return { updated };
}

export async function dismiss(
	db: NotifyD1,
	opts: { userId: string; ids: string[] },
	now: number = Date.now(),
): Promise<{ updated: number }> {
	if (opts.ids.length === 0) return { updated: 0 };
	let updated = 0;
	for (const id of opts.ids) {
		const r = await db
			.prepare(
				"UPDATE in_app_notifications SET dismissed_at = ? WHERE id = ? AND user_id = ? AND dismissed_at IS NULL",
			)
			.bind(now, id, opts.userId)
			.run();
		updated += r.meta?.changes ?? 0;
	}
	return { updated };
}

export async function unreadCount(db: NotifyD1, userId: string): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM in_app_notifications WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL",
		)
		.bind(userId)
		.first<{ n: number }>();
	return Number(row?.n ?? 0);
}

/** Test helper. Exported for use by adapter.ts. */
export { encodeCursor, decodeCursor };
