import type { NotifyD1 } from "../../types";
import { type PhoneCipher, assertE164 } from "./phone";

export interface OptInProof {
	userId: string;
	phoneE164: string;
	optedInAt: number;
	method: string;
	sourceUrl?: string;
	ipHash?: string;
	userAgent?: string;
	revokedAt?: number;
	revokeReason?: string;
}

export interface RecordOptInArgs {
	userId: string;
	phoneE164: string;
	method: string;
	sourceUrl?: string;
	ipHash?: string;
	userAgent?: string;
}

export interface OptInDeps {
	db: NotifyD1;
	cipher?: PhoneCipher;
	now?: () => number;
}

interface RawRow {
	user_id: string;
	phone_e164: string;
	opted_in_at: number;
	method: string;
	source_url: string | null;
	ip_hash: string | null;
	user_agent: string | null;
	revoked_at: number | null;
	revoke_reason: string | null;
}

async function decrypt(cipher: PhoneCipher | undefined, value: string): Promise<string> {
	return cipher ? await cipher.decrypt(value) : value;
}

async function encrypt(cipher: PhoneCipher | undefined, value: string): Promise<string> {
	return cipher ? await cipher.encrypt(value) : value;
}

export async function recordOptIn(deps: OptInDeps, args: RecordOptInArgs): Promise<void> {
	// Validate E.164 at write time too (not just at send time) so the
	// compliance artifact never contains malformed numbers.
	const validatedPhone = assertE164(args.phoneE164);
	const ts = deps.now?.() ?? Date.now();
	const phoneStored = await encrypt(deps.cipher, validatedPhone);
	await deps.db
		.prepare(
			"INSERT INTO wa_optin_proofs(user_id, phone_e164, opted_in_at, method, source_url, ip_hash, user_agent, revoked_at, revoke_reason) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(user_id) DO UPDATE SET phone_e164 = excluded.phone_e164, opted_in_at = excluded.opted_in_at, method = excluded.method, source_url = excluded.source_url, ip_hash = excluded.ip_hash, user_agent = excluded.user_agent, revoked_at = NULL, revoke_reason = NULL",
		)
		.bind(
			args.userId,
			phoneStored,
			ts,
			args.method,
			args.sourceUrl ?? null,
			args.ipHash ?? null,
			args.userAgent ?? null,
		)
		.run();
}

export async function revokeOptIn(deps: OptInDeps, userId: string, reason: string): Promise<void> {
	const ts = deps.now?.() ?? Date.now();
	await deps.db
		.prepare("UPDATE wa_optin_proofs SET revoked_at = ?, revoke_reason = ? WHERE user_id = ?")
		.bind(ts, reason, userId)
		.run();
}

export async function isOptedIn(deps: OptInDeps, userId: string): Promise<boolean> {
	const row = await deps.db
		.prepare("SELECT revoked_at FROM wa_optin_proofs WHERE user_id = ?")
		.bind(userId)
		.first<{ revoked_at: number | null }>();
	if (!row) return false;
	return row.revoked_at === null;
}

export async function getOptInProof(deps: OptInDeps, userId: string): Promise<OptInProof | null> {
	const row = await deps.db
		.prepare(
			"SELECT user_id, phone_e164, opted_in_at, method, source_url, ip_hash, user_agent, revoked_at, revoke_reason FROM wa_optin_proofs WHERE user_id = ?",
		)
		.bind(userId)
		.first<RawRow>();
	if (!row) return null;
	return {
		userId: row.user_id,
		phoneE164: await decrypt(deps.cipher, row.phone_e164),
		optedInAt: row.opted_in_at,
		method: row.method,
		sourceUrl: row.source_url ?? undefined,
		ipHash: row.ip_hash ?? undefined,
		userAgent: row.user_agent ?? undefined,
		revokedAt: row.revoked_at ?? undefined,
		revokeReason: row.revoke_reason ?? undefined,
	};
}
