import type { NotifyD1 } from "./types";

export interface ForgetUserResult {
	prefsDeleted: number;
	optOutsDeleted: number;
	deliveriesDeleted: number;
}

/**
 * Cascade-delete a user's notification footprint from D1. Queue draining
 * is OUT OF SCOPE here — it requires a queue-side primitive that does not
 * exist yet. Document loudly so callers know to also drain their queue.
 */
export async function forgetUser(db: NotifyD1, userId: string): Promise<ForgetUserResult> {
	const prefs = await db
		.prepare("DELETE FROM notification_prefs WHERE user_id = ?")
		.bind(userId)
		.run();
	const optouts = await db
		.prepare("DELETE FROM notification_optouts WHERE user_id = ?")
		.bind(userId)
		.run();
	const deliveries = await db
		.prepare("DELETE FROM notification_deliveries WHERE user_id = ?")
		.bind(userId)
		.run();
	return {
		prefsDeleted: prefs.meta?.changes ?? 0,
		optOutsDeleted: optouts.meta?.changes ?? 0,
		deliveriesDeleted: deliveries.meta?.changes ?? 0,
	};
}
