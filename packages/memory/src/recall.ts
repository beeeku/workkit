import { extractSearchTerms } from "./utils";
import type { Fact, RecallOptions, RecallResult, MemoryResult } from "./types";

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

/**
 * Compute a composite relevance score for a candidate fact.
 *
 * @param similarity   Keyword match ratio [0, 1]
 * @param ageMs        Age of the fact in milliseconds (now - createdAt)
 * @param confidence   Fact's stored confidence [0, 1]
 * @param metadataMatch Whether a subject/tag filter matched
 * @param halfLifeDays  Recency decay half-life in days (default 30)
 */
export function computeScore(
  similarity: number,
  ageMs: number,
  confidence: number,
  metadataMatch: boolean,
  halfLifeDays: number = 30
): number {
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  const recency = Math.pow(0.5, ageMs / halfLifeMs);
  const metadataBonus = metadataMatch ? 1.0 : 0.0;

  return (
    0.6 * similarity +
    0.2 * recency +
    0.1 * confidence +
    0.1 * metadataBonus
  );
}

export interface RecallFactoryOptions {
  decayHalfLifeDays?: number;
  d1ScanLimit?: number;
}

export function createRecall(db: D1Database, factoryOptions: RecallFactoryOptions = {}) {
  const { decayHalfLifeDays = 30, d1ScanLimit = 500 } = factoryOptions;

  return async function recall(
    query: string,
    options: RecallOptions = {}
  ): Promise<MemoryResult<RecallResult[]>> {
    try {
      const {
        subject,
        tags,
        timeRange,
        includeSuperseded = false,
        includeForgotten = false,
        limit = 10,
        threshold = 0.1,
      } = options;

      const now = Date.now();
      const terms = extractSearchTerms(query);

      // ── Build candidate query (same temporal filters as search) ──────────
      const conditions: string[] = [];
      const binds: any[] = [];

      if (!includeForgotten) {
        conditions.push("forgotten_at IS NULL");
        conditions.push("(valid_until IS NULL OR valid_until > ?)");
        binds.push(now);
        conditions.push("(ttl IS NULL OR created_at + ttl * 1000 > ?)");
        binds.push(now);
      }

      if (!includeSuperseded) {
        conditions.push("superseded_by IS NULL");
      }

      if (subject !== undefined) {
        conditions.push("subject = ?");
        binds.push(subject);
      }

      if (tags && tags.length > 0) {
        for (const tag of tags) {
          conditions.push(
            "EXISTS (SELECT 1 FROM json_each(facts.tags) WHERE value = ?)"
          );
          binds.push(tag);
        }
      }

      if (timeRange?.from !== undefined) {
        conditions.push("valid_from >= ?");
        binds.push(timeRange.from);
      }
      if (timeRange?.to !== undefined) {
        conditions.push("valid_from <= ?");
        binds.push(timeRange.to);
      }

      // Keyword LIKE clauses (OR — fetch any fact that contains at least one term)
      if (terms.length > 0) {
        const likeConditions = terms.map(() => "text LIKE ?");
        conditions.push(`(${likeConditions.join(" OR ")})`);
        for (const term of terms) {
          binds.push(`%${term}%`);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM facts ${where} LIMIT ?`;
      binds.push(d1ScanLimit);

      const { results } = await db.prepare(sql).bind(...binds).all();
      const rows = results ?? [];

      // ── Score each candidate ─────────────────────────────────────────────
      const scored: RecallResult[] = [];
      const subjectFilterActive = subject !== undefined;
      const tagsFilterActive = tags && tags.length > 0;

      for (const row of rows) {
        const fact = parseFact(row);

        // Skip superseded facts in output even if they slipped through the WHERE
        if (!includeSuperseded && fact.supersededBy !== null) continue;

        // Keyword match similarity: fraction of query terms found in text
        let similarity = 0;
        if (terms.length > 0) {
          const textLower = fact.text.toLowerCase();
          const matchedTerms = terms.filter((t) => textLower.includes(t));
          similarity = matchedTerms.length / terms.length;
        }

        // Recency: exponential decay
        const ageMs = now - fact.createdAt;

        // Metadata bonus: subject or tag filter was specified and the fact matched it
        const metadataMatch =
          (subjectFilterActive && fact.subject === subject) ||
          (tagsFilterActive && tags!.some((t) => fact.tags.includes(t)));

        const score = computeScore(
          similarity,
          ageMs,
          fact.confidence,
          metadataMatch,
          decayHalfLifeDays
        );

        if (score < threshold) continue;

        scored.push({
          fact,
          score,
          signals: {
            similarity,
            recency: Math.pow(0.5, ageMs / (decayHalfLifeDays * 24 * 60 * 60 * 1000)),
            confidence: fact.confidence,
            metadata: metadataMatch ? 1.0 : 0.0,
          },
        });
      }

      // Sort by score descending, then trim to limit
      scored.sort((a, b) => b.score - a.score);
      return { ok: true, value: scored.slice(0, limit) };
    } catch (error: any) {
      return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
    }
  };
}
