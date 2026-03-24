import type { Fact, FactMetadata, MemoryResult } from "./types";
import { generateFactId } from "./utils";

export function createFactStore(db: D1Database) {
	function parseFact(row: any): Fact {
		return {
			id: row.id,
			text: row.text,
			subject: row.subject ?? null,
			source: row.source ?? null,
			tags: row.tags ? JSON.parse(row.tags) : [],
			confidence: row.confidence ?? 1.0,
			encrypted: Boolean(row.encrypted),
			createdAt: row.created_at,
			validFrom: row.valid_from,
			validUntil: row.valid_until ?? null,
			supersededBy: row.superseded_by ?? null,
			forgottenAt: row.forgotten_at ?? null,
			forgottenReason: row.forgotten_reason ?? null,
			embeddingStatus: row.embedding_status ?? "pending",
			ttl: row.ttl ?? null,
		};
	}

	return {
		async remember(text: string, metadata?: FactMetadata): Promise<MemoryResult<Fact>> {
			try {
				const id = generateFactId();
				const now = Date.now();
				const fact: Fact = {
					id,
					text,
					subject: metadata?.subject ?? null,
					source: metadata?.source ?? null,
					tags: metadata?.tags ?? [],
					confidence: metadata?.confidence ?? 1.0,
					encrypted: metadata?.encrypted ?? false,
					createdAt: now,
					validFrom: metadata?.validFrom ?? now,
					validUntil: null,
					supersededBy: null,
					forgottenAt: null,
					forgottenReason: null,
					embeddingStatus: "pending",
					ttl: metadata?.ttl ?? null,
				};

				await db
					.prepare(
						`INSERT INTO facts (id, text, subject, source, tags, confidence, encrypted, created_at, valid_from, valid_until, superseded_by, forgotten_at, forgotten_reason, embedding_status, ttl, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(
						fact.id,
						fact.text,
						fact.subject,
						fact.source,
						JSON.stringify(fact.tags),
						fact.confidence,
						fact.encrypted ? 1 : 0,
						fact.createdAt,
						fact.validFrom,
						fact.validUntil,
						fact.supersededBy,
						fact.forgottenAt,
						fact.forgottenReason,
						fact.embeddingStatus,
						fact.ttl,
						metadata?.idempotencyKey ?? null,
					)
					.run();

				// Handle supersession
				if (metadata?.supersedes) {
					await db
						.prepare("UPDATE facts SET superseded_by = ?, valid_until = ? WHERE id = ?")
						.bind(fact.id, now, metadata.supersedes)
						.run();
				}

				return { ok: true, value: fact };
			} catch (error: any) {
				if (error.message?.includes("UNIQUE constraint")) {
					return {
						ok: false,
						error: {
							code: "IDEMPOTENCY_ERROR",
							message: "Fact with this idempotency key already exists",
						},
					};
				}
				return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
			}
		},

		async rememberBatch(
			facts: Array<{ fact: string; metadata?: FactMetadata }>,
		): Promise<MemoryResult<Fact[]>> {
			// Build all facts then batch insert
			const results: Fact[] = [];
			for (const { fact: text, metadata } of facts) {
				const result = await this.remember(text, metadata);
				if (!result.ok) return result as any;
				results.push(result.value);
			}
			return { ok: true, value: results };
		},

		async get(factId: string): Promise<MemoryResult<Fact | null>> {
			try {
				const row = await db.prepare("SELECT * FROM facts WHERE id = ?").bind(factId).first();
				return { ok: true, value: row ? parseFact(row) : null };
			} catch (error: any) {
				return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
			}
		},

		async forget(factId: string, reason?: string): Promise<MemoryResult<void>> {
			try {
				await db
					.prepare("UPDATE facts SET forgotten_at = ?, forgotten_reason = ? WHERE id = ?")
					.bind(Date.now(), reason ?? null, factId)
					.run();
				return { ok: true, value: undefined };
			} catch (error: any) {
				return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
			}
		},

		async supersede(
			oldFactId: string,
			newText: string,
			metadata?: FactMetadata,
		): Promise<MemoryResult<Fact>> {
			try {
				// Get old fact for inheriting metadata
				const oldRow = await db.prepare("SELECT * FROM facts WHERE id = ?").bind(oldFactId).first();

				const inheritedMetadata: FactMetadata = {
					subject: metadata?.subject ?? (oldRow as any)?.subject ?? undefined,
					source: metadata?.source ?? (oldRow as any)?.source ?? undefined,
					tags:
						metadata?.tags ??
						((oldRow as any)?.tags ? JSON.parse((oldRow as any).tags) : undefined),
					supersedes: oldFactId,
					...metadata,
				};

				return this.remember(newText, inheritedMetadata);
			} catch (error: any) {
				return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
			}
		},

		async expire(factId: string, ttlSeconds: number): Promise<MemoryResult<void>> {
			try {
				await db.prepare("UPDATE facts SET ttl = ? WHERE id = ?").bind(ttlSeconds, factId).run();
				return { ok: true, value: undefined };
			} catch (error: any) {
				return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
			}
		},

		parseFact,
	};
}
