import type { ChannelName, DeliveryStatus, NotifyD1 } from "./types";

export interface DeliveryRow {
	id: string;
	userId: string;
	notificationId: string;
	channel: ChannelName;
	status: DeliveryStatus;
	idempotencyKey: string;
	payload: string | null;
	providerId: string | null;
	error: string | null;
	attemptedAt: number;
	deliveredAt: number | null;
}

export interface InsertDeliveryArgs {
	id: string;
	userId: string;
	notificationId: string;
	channel: ChannelName;
	status: DeliveryStatus;
	idempotencyKey: string;
	payload?: string | null;
	providerId?: string | null;
	error?: string | null;
	attemptedAt: number;
	deliveredAt?: number | null;
}

/** Returns true when the row was inserted; false on UNIQUE collision (duplicate). */
export async function insertDelivery(db: NotifyD1, args: InsertDeliveryArgs): Promise<boolean> {
	try {
		await db
			.prepare(
				"INSERT INTO notification_deliveries(id, user_id, notification_id, channel, status, idempotency_key, payload, provider_id, error, attempted_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(
				args.id,
				args.userId,
				args.notificationId,
				args.channel,
				args.status,
				args.idempotencyKey,
				args.payload ?? null,
				args.providerId ?? null,
				args.error ?? null,
				args.attemptedAt,
				args.deliveredAt ?? null,
			)
			.run();
		return true;
	} catch (err) {
		if (isUniqueViolation(err)) return false;
		throw err;
	}
}

export async function updateDeliveryStatus(
	db: NotifyD1,
	id: string,
	status: DeliveryStatus,
	patch: { providerId?: string; error?: string; deliveredAt?: number } = {},
): Promise<void> {
	await db
		.prepare(
			"UPDATE notification_deliveries SET status = ?, provider_id = COALESCE(?, provider_id), error = COALESCE(?, error), delivered_at = COALESCE(?, delivered_at) WHERE id = ?",
		)
		.bind(status, patch.providerId ?? null, patch.error ?? null, patch.deliveredAt ?? null, id)
		.run();
}

export async function findByIdempotencyKey(
	db: NotifyD1,
	idempotencyKey: string,
): Promise<DeliveryRow | null> {
	const row = await db
		.prepare(
			"SELECT id, user_id AS userId, notification_id AS notificationId, channel, status, idempotency_key AS idempotencyKey, payload, provider_id AS providerId, error, attempted_at AS attemptedAt, delivered_at AS deliveredAt FROM notification_deliveries WHERE idempotency_key = ?",
		)
		.bind(idempotencyKey)
		.first<DeliveryRow>();
	return row ?? null;
}

export async function purgeOlderThan(
	db: NotifyD1,
	olderThanMs: number,
	now: number = Date.now(),
): Promise<{ deleted: number }> {
	const cutoff = now - olderThanMs;
	const result = await db
		.prepare("DELETE FROM notification_deliveries WHERE attempted_at < ?")
		.bind(cutoff)
		.run();
	return { deleted: result.meta?.changes ?? 0 };
}

function isUniqueViolation(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("unique") || msg.includes("constraint failed");
}
