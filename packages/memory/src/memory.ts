import type {
  Memory,
  MemoryOptions,
  MemoryResult,
  MemoryStats,
  Fact,
  FactMetadata,
  RecallResult,
  RecallOptions,
  SearchOptions,
  CompactOptions,
  CompactResult,
  ReembedOptions,
  ReembedResult,
  ConversationOptions,
  Conversation,
  ScopedMemory,
} from "./types";
import { createFactStore } from "./facts";
import { createSearch } from "./search";
import { createRecall } from "./recall";
import { createCache } from "./cache";
import { createEmbeddingPipeline } from "./embeddings";
import { createConversation } from "./conversation";
import { createScopedMemory } from "./temporal";

export function createMemory(options: MemoryOptions): Memory {
  const { db } = options;
  const facts = createFactStore(db);
  const search = createSearch(db);
  const recall = createRecall(db, {
    decayHalfLifeDays: options.decayHalfLifeDays,
    d1ScanLimit: options.d1ScanLimit,
  });
  const cache = createCache(options.cache);
  const embeddings = createEmbeddingPipeline({
    ai: options.embeddings,
    model: options.embeddingModel,
    dimensions: options.embeddingDimensions,
  });

  const mode = options.vectorize ? "d1+vectorize" : "d1-only";

  const memory: Memory = {
    async remember(fact: string, metadata?: FactMetadata): Promise<MemoryResult<Fact>> {
      const result = await facts.remember(fact, metadata);
      if (result.ok) {
        // Generate embedding if available
        if (embeddings.enabled) {
          const vector = await embeddings.embed(fact);
          if (vector) {
            await embeddings.storeEmbedding(result.value.id, vector, db);
          }
        }
        // Invalidate recall caches
        await cache.invalidate();
        // Piggyback: retry pending embeddings
        if (embeddings.enabled) {
          await embeddings.retryPending(db, 5);
        }
      }
      return result;
    },

    async rememberBatch(items: Array<{ fact: string; metadata?: FactMetadata }>): Promise<MemoryResult<Fact[]>> {
      const result = await facts.rememberBatch(items);
      if (result.ok) {
        if (embeddings.enabled) {
          for (const fact of result.value) {
            const vector = await embeddings.embed(fact.text);
            if (vector) {
              await embeddings.storeEmbedding(fact.id, vector, db);
            }
          }
        }
        await cache.invalidate();
      }
      return result;
    },

    async recall(query: string, opts?: RecallOptions): Promise<MemoryResult<RecallResult[]>> {
      if (!opts?.noCache) {
        const cacheKey = `recall:${query}:${JSON.stringify(opts ?? {})}`;
        const cached = await cache.get<RecallResult[]>(cacheKey);
        if (cached) return { ok: true, value: cached };

        const result = await recall(query, opts);
        if (result.ok) await cache.set(cacheKey, result.value, 300);
        return result;
      }
      return recall(query, opts);
    },

    async search(query: string, opts?: SearchOptions): Promise<MemoryResult<Fact[]>> {
      return search(query, opts);
    },

    async get(factId: string): Promise<MemoryResult<Fact | null>> {
      return facts.get(factId);
    },

    async forget(factId: string, reason?: string): Promise<MemoryResult<void>> {
      const result = await facts.forget(factId, reason);
      if (result.ok) await cache.invalidate();
      return result;
    },

    async supersede(oldFactId: string, newFact: string, metadata?: FactMetadata): Promise<MemoryResult<Fact>> {
      const result = await facts.supersede(oldFactId, newFact, metadata);
      if (result.ok) await cache.invalidate();
      return result;
    },

    async expire(factId: string, ttlSeconds: number): Promise<MemoryResult<void>> {
      return facts.expire(factId, ttlSeconds);
    },

    at(timestamp: number): ScopedMemory {
      return createScopedMemory(timestamp, {
        recall: (q, o) => recall(q, o),
        search: (q, o) => search(q, o),
        get: (id) => facts.get(id),
        stats: () => memory.stats(),
      });
    },

    conversation(id: string, opts?: ConversationOptions): Conversation {
      return createConversation(id, db, opts);
    },

    async stats(): Promise<MemoryResult<MemoryStats>> {
      try {
        const total = await db.prepare("SELECT COUNT(*) as c FROM facts").first<{ c: number }>();
        const active = await db
          .prepare(
            "SELECT COUNT(*) as c FROM facts WHERE forgotten_at IS NULL AND superseded_by IS NULL AND (valid_until IS NULL OR valid_until > ?)"
          )
          .bind(Date.now())
          .first<{ c: number }>();
        const superseded = await db
          .prepare("SELECT COUNT(*) as c FROM facts WHERE superseded_by IS NOT NULL")
          .first<{ c: number }>();
        const forgotten = await db
          .prepare("SELECT COUNT(*) as c FROM facts WHERE forgotten_at IS NOT NULL")
          .first<{ c: number }>();
        const pending = await db
          .prepare("SELECT COUNT(*) as c FROM facts WHERE embedding_status = 'pending'")
          .first<{ c: number }>();
        const convos = await db
          .prepare("SELECT COUNT(DISTINCT conversation_id) as c FROM messages")
          .first<{ c: number }>();
        const msgs = await db.prepare("SELECT COUNT(*) as c FROM messages").first<{ c: number }>();
        const sums = await db.prepare("SELECT COUNT(*) as c FROM summaries").first<{ c: number }>();

        return {
          ok: true,
          value: {
            totalFacts: total?.c ?? 0,
            activeFacts: active?.c ?? 0,
            supersededFacts: superseded?.c ?? 0,
            forgottenFacts: forgotten?.c ?? 0,
            pendingEmbeddings: pending?.c ?? 0,
            conversations: convos?.c ?? 0,
            totalMessages: msgs?.c ?? 0,
            totalSummaries: sums?.c ?? 0,
            mode,
            embeddingModel: options.embeddingModel ?? "@cf/baai/bge-base-en-v1.5",
          },
        };
      } catch (error: any) {
        return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
      }
    },

    async compact(opts?: CompactOptions): Promise<MemoryResult<CompactResult>> {
      // v0.1.0: basic expiry cleanup only
      try {
        const start = Date.now();
        const now = Date.now();
        // Clean expired facts
        const { results } = await db
          .prepare(
            "SELECT id FROM facts WHERE ttl IS NOT NULL AND created_at + ttl * 1000 < ? AND forgotten_at IS NULL"
          )
          .bind(now)
          .all();

        for (const row of results) {
          await facts.forget(row.id as string, "expired");
        }

        return {
          ok: true,
          value: { mergedCount: 0, expiredCount: results.length, reembeddedCount: 0, durationMs: Date.now() - start },
        };
      } catch (error: any) {
        return { ok: false, error: { code: "COMPACTION_ERROR", message: error.message } };
      }
    },

    async reembed(opts?: ReembedOptions): Promise<MemoryResult<ReembedResult>> {
      if (!embeddings.enabled) {
        return { ok: false, error: { code: "EMBEDDING_ERROR", message: "No AI binding configured" } };
      }
      try {
        const start = Date.now();
        const count = await embeddings.retryPending(db, opts?.batchSize ?? 50);
        return { ok: true, value: { processedCount: count, failedCount: 0, durationMs: Date.now() - start } };
      } catch (error: any) {
        return { ok: false, error: { code: "EMBEDDING_ERROR", message: error.message } };
      }
    },
  };

  return memory;
}
