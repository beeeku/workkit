import type { NotifyD1 } from "../../types";
import type { SseRegistry } from "./sse";

export interface ForgetInAppResult {
	rowsDeleted: number;
}

/**
 * Cascade-delete a user's in-app notification feed AND drop any active
 * SSE subscriptions for that user. Call alongside `@workkit/notify`'s
 * `forgetUser` for the full GDPR/DPDP cascade.
 */
export async function forgetInAppUser(
	db: NotifyD1,
	userId: string,
	registry?: SseRegistry,
): Promise<ForgetInAppResult> {
	const r = await db
		.prepare("DELETE FROM in_app_notifications WHERE user_id = ?")
		.bind(userId)
		.run();
	registry?.disconnectUser(userId);
	return { rowsDeleted: r.meta?.changes ?? 0 };
}
