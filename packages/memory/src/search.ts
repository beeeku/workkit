import type { Fact, MemoryResult, SearchOptions } from "./types";
import { extractSearchTerms } from "./utils";

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

const ORDER_COLUMN: Record<NonNullable<SearchOptions["orderBy"]>, string> = {
	createdAt: "created_at",
	validFrom: "valid_from",
	confidence: "confidence",
};

export function createSearch(db: D1Database) {
	return async function search(
		query: string,
		options: SearchOptions = {},
	): Promise<MemoryResult<Fact[]>> {
		try {
			const {
				subject,
				tags,
				timeRange,
				includeSuperseded = false,
				includeForgotten = false,
				limit = 20,
				offset = 0,
				orderBy = "createdAt",
				order = "desc",
			} = options;

			const now = Date.now();
			const conditions: string[] = [];
			const binds: any[] = [];

			// Temporal filter
			if (!includeForgotten) {
				conditions.push("forgotten_at IS NULL");
				conditions.push("(valid_until IS NULL OR valid_until > ?)");
				binds.push(now);
				conditions.push("(ttl IS NULL OR created_at + ttl * 1000 > ?)");
				binds.push(now);
			}

			// Superseded filter
			if (!includeSuperseded) {
				conditions.push("superseded_by IS NULL");
			}

			// Subject filter
			if (subject !== undefined) {
				conditions.push("subject = ?");
				binds.push(subject);
			}

			// Tags filter — check each tag is present in the JSON array
			if (tags && tags.length > 0) {
				for (const tag of tags) {
					conditions.push("EXISTS (SELECT 1 FROM json_each(facts.tags) WHERE value = ?)");
					binds.push(tag);
				}
			}

			// Time range filter
			if (timeRange?.from !== undefined) {
				conditions.push("valid_from >= ?");
				binds.push(timeRange.from);
			}
			if (timeRange?.to !== undefined) {
				conditions.push("valid_from <= ?");
				binds.push(timeRange.to);
			}

			// Keyword LIKE clauses
			const terms = extractSearchTerms(query);
			if (terms.length > 0) {
				const likeConditions = terms.map(() => "text LIKE ?");
				conditions.push(`(${likeConditions.join(" OR ")})`);
				for (const term of terms) {
					binds.push(`%${term}%`);
				}
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
			const col = ORDER_COLUMN[orderBy] ?? "created_at";
			const dir = order === "asc" ? "ASC" : "DESC";

			const sql = `SELECT * FROM facts ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`;
			binds.push(limit, offset);

			const { results } = await db
				.prepare(sql)
				.bind(...binds)
				.all();
			return { ok: true, value: (results ?? []).map(parseFact) };
		} catch (error: any) {
			return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
		}
	};
}
