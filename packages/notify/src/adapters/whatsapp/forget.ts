import type { NotifyD1 } from "../../types";

export interface ForgetWhatsAppResult {
	optInRowsDeleted: number;
	mediaCacheRowsDeleted: number;
	inboundLogRowsDeleted: number;
}

/**
 * Cascade-delete a user's WhatsApp footprint from D1: opt-in proof,
 * inbound message log. Media-cache rows are NOT user-keyed (they're keyed
 * by R2 etag) so we leave them; the global TTL purge handles eviction.
 *
 * Caller should also invoke `@workkit/notify`'s `forgetUser` to drop the
 * preferences/opt-out/delivery-record rows in the same transaction.
 */
export async function forgetWhatsAppUser(
	db: NotifyD1,
	userId: string,
): Promise<ForgetWhatsAppResult> {
	const optIn = await db
		.prepare("DELETE FROM wa_optin_proofs WHERE user_id = ?")
		.bind(userId)
		.run();
	const inbound = await db
		.prepare("DELETE FROM wa_inbound_log WHERE user_id = ?")
		.bind(userId)
		.run();
	return {
		optInRowsDeleted: optIn.meta?.changes ?? 0,
		mediaCacheRowsDeleted: 0,
		inboundLogRowsDeleted: inbound.meta?.changes ?? 0,
	};
}
