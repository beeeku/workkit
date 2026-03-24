# @workkit/memory — Edge-Native Agent Memory

**Date:** 2026-03-24
**Author:** Jarvis + Bikash
**Status:** Draft
**Layer:** 2 (Application) — depends on @workkit/d1, @workkit/kv, @workkit/ai, @workkit/crypto, @workkit/errors, @workkit/types

---

## Goal

A memory system for AI agents running on Cloudflare Workers. Store facts, retrieve them with hybrid search, manage conversation history with automatic compaction, and query temporal snapshots — all at the edge with zero cold starts.

**The bar:** An agent should be able to `memory.remember("User prefers dark mode")` and later `memory.recall("what theme does the user like?")` and get the right answer back in <50ms from cache or <200ms from D1. No external vector databases. No managed services beyond what Cloudflare already provides.

**Dual mode:** Works with D1 alone (keyword search, zero extra bindings) or D1 + Vectorize (proper vector similarity) when the binding is available. Same API, better recall quality when you opt in.

## Design Principles

1. **Zero-binding start** — `createMemory({ db })` with just a D1 binding gives you a working memory system. KV cache, embeddings, and Vectorize are progressive enhancements.
2. **Facts, not documents** — The unit of storage is a fact (a single assertion), not a document. Facts can supersede each other, expire, and be forgotten. This models how memory actually works.
3. **Temporal by default** — Every fact has `valid_from` and `valid_until`. Memory is not a key-value store — it's a timeline. `memory.at(timestamp)` gives you a snapshot of what was true at any point.
4. **Hybrid retrieval** — Recall combines vector similarity (or keyword match), metadata filters, recency weighting, and supersession awareness into a single ranked result set.
5. **Conversation-aware** — First-class conversation memory with token budgeting and LLM-powered compaction. Conversations are the most common memory pattern for agents.
6. **Encryption-ready** — PII-sensitive facts can be encrypted at rest via @workkit/crypto. The memory system handles transparent encrypt/decrypt.

---

## 1. Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  createMemory({ db, cache?, embeddings?, vectorize? })          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ remember()    │  │ recall()     │  │ conversation()          │ │
│  │ forget()      │  │ search()     │  │   .add() .get()        │ │
│  │ at()          │  │ stats()      │  │   .summarize()         │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘ │
│         │                  │                      │               │
│  ┌──────▼──────────────────▼──────────────────────▼─────────────┐│
│  │                   Storage Router                              ││
│  │  Decides: D1-only vs D1+Vectorize based on config             ││
│  └──────┬──────────────┬──────────────┬─────────────────────────┘│
│         │              │              │                           │
│  ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐ ┌──────────────┐ │
│  │  D1         │ │  KV Cache  │ │ Workers AI │ │  Vectorize   │ │
│  │  (facts,    │ │  (hot      │ │ (embedding │ │  (vector     │ │
│  │  edges,     │ │  recall    │ │ generation)│ │   index)     │ │
│  │  convos)    │ │  results)  │ │            │ │  [optional]  │ │
│  └─────────────┘ └───────────┘ └────────────┘ └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Storage Schema: D1 Tables

All persistent state lives in D1. Six tables, designed for efficient query patterns.

### Dual Mode: D1-Only vs D1+Vectorize

**D1-Only Mode** (default):
- Embeddings stored as JSON arrays in `fact_embeddings` table
- Search uses keyword matching (`LIKE` queries with term extraction) plus optional cosine similarity computed in-worker from stored embeddings
- Good enough for <10K facts. Degrades gracefully beyond that.
- Zero additional bindings required.

**D1+Vectorize Mode** (opt-in):
- Embeddings stored in both D1 (for backup/migration) and Vectorize (for search)
- Search uses Vectorize's native ANN (approximate nearest neighbor) — sub-10ms at any scale
- Best recall quality. Required for >10K facts.
- Requires a `VectorizeIndex` binding in wrangler.toml.

The mode is auto-detected: if `vectorize` is passed to `createMemory()`, Vectorize mode is active. Otherwise, D1-only.

### KV Cache Layer

**What's cached:**
- Recall results: keyed by `recall:{hash(query + filters)}`, TTL 300s (5 min)
- Fact lookups by ID: keyed by `fact:{id}`, TTL 600s (10 min)
- Conversation message counts: keyed by `conv:{id}:count`, TTL 60s (1 min)
- Stats: keyed by `memory:stats`, TTL 120s (2 min)

**Invalidation strategy (cache generation counter):**

Instead of listing and deleting individual cache keys (which requires N `list()` + `delete()` calls), invalidation uses a **cache generation counter**. A single KV key `memory:gen` holds the current generation number. This counter is included in all cache keys (e.g., `recall:gen42:{hash}`). When data changes, the generation is bumped with a single `put()` — all old-generation cache keys become unreachable and expire naturally via TTL.

- `remember()` bumps `memory:gen` (one `put()` call). All recall caches from the previous generation are effectively invalidated.
- `remember()` does NOT invalidate individual fact caches (new facts don't change old fact data)
- `forget()` bumps `memory:gen` and deletes the specific fact cache key
- Conversation `add()` invalidates the conversation count cache only
- Stats are eventually consistent (TTL-based, no active invalidation)

This reduces invalidation from O(N) KV operations to O(1) per write.

**Why KV and not Cache API:** KV is binding-based and available in all Workers (including cron triggers, queue consumers, DO). The Cache API requires a request context. For an agent memory system that may be accessed from non-HTTP contexts, KV is the right primitive.

### Embedding Pipeline

```
fact text → estimateTokens() check → Workers AI embedding model → float32[] → storage
                                          │
                                          ├─ D1: fact_embeddings table (JSON array)
                                          └─ Vectorize: upsert vector (if available)
```

- **Model:** `@cf/baai/bge-base-en-v1.5` (768 dimensions, good English quality). Configurable via `embeddingModel` option.
- **Token guard:** `estimateTokens(text)` is checked before calling Workers AI. If >512 tokens, text is truncated to first 512 tokens worth of content (embedding models have input limits).
- **Batching:** Workers AI supports batch embedding (up to 100 texts). `remember()` for a single fact embeds inline. `rememberBatch()` uses batch embedding for efficiency.
- **Failure handling:** If embedding generation fails (rate limit, model error), the fact is stored without an embedding and marked `embedding_status = 'pending'`. A retry mechanism re-embeds pending facts on the next `remember()` call (piggyback strategy — no separate cron needed).

### Temporal Queries

Every fact row has `valid_from` (required, defaults to `Date.now()`) and `valid_until` (nullable, set when superseded or expired).

`memory.at(timestamp)` returns a scoped memory instance where all queries filter to `valid_from <= timestamp AND (valid_until IS NULL OR valid_until > timestamp)`. This means:
- Facts created after the timestamp are invisible
- Facts superseded before the timestamp show the superseded version, not the current one
- Forgotten facts with `forgotten_at <= timestamp` are excluded

This enables "what did the agent know at time T?" — critical for debugging agent behavior and audit trails.

---

## 2. Complete API Surface

### Factory

```ts
import { createMemory } from '@workkit/memory'

interface MemoryOptions {
  /** D1 database binding (required) */
  db: D1Database
  /** KV namespace for caching (optional, improves read performance) */
  cache?: KVNamespace
  /** Workers AI binding for embedding generation (optional, enables semantic search) */
  embeddings?: Ai
  /** Vectorize index binding (optional, enables high-quality vector search) */
  vectorize?: VectorizeIndex
  /** Embedding model to use (default: '@cf/baai/bge-base-en-v1.5') */
  embeddingModel?: string
  /** Embedding dimensions (default: 768, must match model and Vectorize index) */
  embeddingDimensions?: number
  /** Encryption key for PII facts (optional, enables at-rest encryption) */
  encryptionKey?: CryptoKey
  /** Default TTL for facts in seconds (optional, null = no expiry) */
  defaultTtl?: number
  /** Maximum facts to scan in D1-only mode cosine search (default: 500).
   *  Lower than you might expect because loading embedding arrays (768 float32s
   *  as JSON ≈ 6KB each) creates significant memory pressure in the Worker
   *  isolate. At 500 facts, that's ~3MB of embedding data in memory. */
  d1ScanLimit?: number
  /** Relevance decay half-life in days (default: 30) */
  decayHalfLifeDays?: number
  /** Logger instance (optional) */
  logger?: Logger
}

function createMemory(options: MemoryOptions): Memory
```

### Core Interface

```ts
interface Memory {
  // ─── Write ────────────────────────────────────────────────────
  remember(fact: string, metadata?: FactMetadata): Promise<Result<Fact, MemoryError>>
  rememberBatch(facts: Array<{ fact: string; metadata?: FactMetadata }>): Promise<Result<Fact[], MemoryError>>

  // ─── Read ─────────────────────────────────────────────────────
  recall(query: string, options?: RecallOptions): Promise<Result<RecallResult[], MemoryError>>
  search(query: string, options?: SearchOptions): Promise<Result<Fact[], MemoryError>>
  get(factId: string): Promise<Result<Fact | null, MemoryError>>

  // ─── Lifecycle ────────────────────────────────────────────────
  forget(factId: string, reason?: string): Promise<Result<void, MemoryError>>
  supersede(oldFactId: string, newFact: string, metadata?: FactMetadata): Promise<Result<Fact, MemoryError>>
  expire(factId: string, ttlSeconds: number): Promise<Result<void, MemoryError>>

  // ─── Temporal ─────────────────────────────────────────────────
  at(timestamp: number): ScopedMemory

  // ─── Conversations ────────────────────────────────────────────
  conversation(id: string, options?: ConversationOptions): Conversation

  // ─── Introspection ────────────────────────────────────────────
  stats(): Promise<Result<MemoryStats, MemoryError>>

  // ─── Maintenance ──────────────────────────────────────────────
  compact(options?: CompactOptions): Promise<Result<CompactResult, MemoryError>>
  reembed(options?: ReembedOptions): Promise<Result<ReembedResult, MemoryError>>

  // ─── Integration ──────────────────────────────────────────────
  inject(options?: InjectOptions): MiddlewareFn
}
```

### Types

```ts
// ─── Fact ───────────────────────────────────────────────────────

interface Fact {
  id: string                    // nanoid, e.g. "fact_V1StGXR8_Z5jdHi"
  text: string                  // The fact content (decrypted if encrypted)
  subject: string | null        // What/who this fact is about
  source: string | null         // Where this fact came from
  tags: string[]                // Categorical labels
  confidence: number            // 0.0 - 1.0 (default: 1.0)
  encrypted: boolean            // Whether stored encrypted
  createdAt: number             // Unix ms
  validFrom: number             // Unix ms — when this fact became true
  validUntil: number | null     // Unix ms — when this fact stopped being true
  supersededBy: string | null   // ID of the fact that replaced this one
  forgottenAt: number | null    // Unix ms — soft delete timestamp
  forgottenReason: string | null
  embeddingStatus: 'complete' | 'pending' | 'failed'
  ttl: number | null            // Seconds until auto-expiry (from createdAt)
}

interface FactMetadata {
  subject?: string
  source?: string
  tags?: string[]
  confidence?: number
  encrypted?: boolean           // Encrypt this fact at rest
  validFrom?: number            // Backdate the fact (default: now)
  supersedes?: string           // ID of fact this replaces
  ttl?: number                  // Seconds until auto-expiry
  idempotencyKey?: string       // Prevent duplicate storage of the same fact
}

// ─── Recall ─────────────────────────────────────────────────────

interface RecallOptions {
  /** Filter by subject */
  subject?: string
  /** Filter by tags (AND — all must match).
   *  Uses json_each() for array containment — not LIKE substring matching.
   *  e.g., tag 'dev' will NOT match a fact tagged 'development'. */
  tags?: string[]
  /** Filter by time range */
  timeRange?: { from?: number; to?: number }
  /** Include superseded facts (default: false) */
  includeSuperseded?: boolean
  /** Include forgotten facts (default: false) */
  includeForgotten?: boolean
  /** Max results (default: 10) */
  limit?: number
  /** Minimum relevance score 0.0-1.0 (default: 0.1) */
  threshold?: number
  /** Disable KV cache for this query (default: false) */
  noCache?: boolean
}

interface RecallResult {
  fact: Fact
  score: number                 // Combined relevance score 0.0-1.0
  signals: {
    similarity: number          // Vector similarity or keyword match score
    recency: number             // Time decay score
    confidence: number          // Fact confidence
    metadata: number            // Metadata filter match bonus
  }
}

interface SearchOptions {
  subject?: string
  tags?: string[]
  timeRange?: { from?: number; to?: number }
  includeSuperseded?: boolean
  includeForgotten?: boolean
  limit?: number
  offset?: number
  orderBy?: 'createdAt' | 'validFrom' | 'confidence'
  order?: 'asc' | 'desc'
}

// ─── Conversation ───────────────────────────────────────────────

interface ConversationOptions {
  /** Max tokens for conversation retrieval (default: 4096) */
  tokenBudget?: number
  /** Compaction strategy (default: 'sliding-window') */
  compaction?: 'sliding-window' | 'token-budget' | 'summary'
  /** For sliding-window: max messages to keep (default: 50) */
  windowSize?: number
  /** For summary compaction: model to use (default: '@cf/meta/llama-3.1-8b-instruct') */
  summaryModel?: string
  /** System prompt to include in conversation context */
  systemPrompt?: string
}

interface Conversation {
  readonly id: string

  add(message: ConversationMessage): Promise<Result<StoredMessage, MemoryError>>
  get(options?: ConversationGetOptions): Promise<Result<ConversationSnapshot, MemoryError>>
  summarize(options?: SummarizeOptions): Promise<Result<Summary, MemoryError>>
  clear(): Promise<Result<void, MemoryError>>
  messages(options?: MessageListOptions): Promise<Result<StoredMessage[], MemoryError>>
}

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string                 // Tool name or user name
  metadata?: Record<string, unknown>
}

interface StoredMessage {
  id: string
  conversationId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name: string | null
  metadata: Record<string, unknown>
  tokenCount: number            // Estimated via estimateTokens()
  createdAt: number
  compactedInto: string | null  // Summary ID if compacted
}

interface ConversationGetOptions {
  /** Override token budget for this retrieval */
  tokenBudget?: number
  /** Include compacted (summarized) messages (default: false) */
  includeCompacted?: boolean
}

interface ConversationSnapshot {
  id: string
  messages: StoredMessage[]
  summaries: Summary[]          // Summaries of compacted messages
  totalTokens: number           // Estimated tokens in this snapshot
  totalMessages: number         // Total messages (including compacted)
  activeMessages: number        // Messages not yet compacted
}

interface Summary {
  id: string
  conversationId: string
  content: string               // The summary text
  messageRange: { from: string; to: string }  // Message IDs covered
  messageCount: number
  originalTokens: number        // Tokens before compaction
  summaryTokens: number         // Tokens after compaction
  createdAt: number
}

interface SummarizeOptions {
  /** Summarize messages older than this (default: keep last windowSize) */
  keepRecent?: number
  /** Custom summarization prompt */
  prompt?: string
}

// ─── Temporal ───────────────────────────────────────────────────

/** A memory scoped to a point in time. Same API as Memory but all reads are filtered. */
interface ScopedMemory {
  recall(query: string, options?: RecallOptions): Promise<Result<RecallResult[], MemoryError>>
  search(query: string, options?: SearchOptions): Promise<Result<Fact[], MemoryError>>
  get(factId: string): Promise<Result<Fact | null, MemoryError>>
  stats(): Promise<Result<MemoryStats, MemoryError>>
}

// ─── Maintenance ────────────────────────────────────────────────

interface CompactOptions {
  /** Merge facts with similarity above this threshold (default: 0.95) */
  mergeThreshold?: number
  /** Only compact facts older than this (seconds, default: 86400 = 1 day) */
  minAge?: number
  /** Max facts to process per compaction run (default: 100) */
  batchSize?: number
  /** Dry run — return what would be compacted without doing it (default: false) */
  dryRun?: boolean
}

interface CompactResult {
  mergedCount: number           // Facts merged into existing facts
  expiredCount: number          // Facts removed due to TTL expiry
  reembeddedCount: number       // Facts with pending embeddings that were re-embedded
  durationMs: number
}

interface ReembedOptions {
  /** Re-embed all facts (not just pending). Use after model change. */
  force?: boolean
  /** Max facts to re-embed per run (default: 50) */
  batchSize?: number
}

interface ReembedResult {
  processedCount: number
  failedCount: number
  durationMs: number
}

// ─── Stats ──────────────────────────────────────────────────────

interface MemoryStats {
  totalFacts: number
  activeFacts: number           // Not superseded, not forgotten, not expired
  supersededFacts: number
  forgottenFacts: number
  pendingEmbeddings: number
  conversations: number
  totalMessages: number
  totalSummaries: number
  storageEstimate: {
    factsBytes: number
    embeddingsBytes: number
    conversationsBytes: number
  }
  mode: 'd1-only' | 'd1+vectorize'
  embeddingModel: string
}

// ─── Integration ────────────────────────────────────────────────

interface InjectOptions {
  /** Max tokens of context to inject (default: 1024) */
  tokenBudget?: number
  /** How to resolve the query from the request/tool input */
  queryResolver?: (input: unknown) => string
  /** How to resolve the subject from the request/tool input */
  subjectResolver?: (input: unknown) => string | undefined
  /** Tags to filter by */
  tags?: string[]
  /** Where to inject context (default: 'system') */
  placement?: 'system' | 'user' | 'context'
}

// ─── Errors ─────────────────────────────────────────────────────

type MemoryError =
  | MemoryStorageError          // D1 write/read failure
  | MemoryEmbeddingError        // Workers AI embedding failure
  | MemoryVectorizeError        // Vectorize upsert/query failure
  | MemoryCacheError            // KV cache failure (non-fatal, logged)
  | MemoryEncryptionError       // Encrypt/decrypt failure
  | MemoryCompactionError       // Compaction/summarization failure
  | MemoryNotFoundError         // Fact or conversation not found
  | MemoryIdempotencyError      // Duplicate idempotency key
```

---

## 3. Hybrid Retrieval System

### How `recall()` Works

`recall()` is the primary read path. It combines multiple signals into a single ranked result set.

```
recall("what theme does the user prefer?", { limit: 5 })
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 1. KV Cache Check                                    │
│    Key: recall:{sha256(query + JSON(filters))}       │
│    Hit? → Return cached results                      │
│    Miss? → Continue to search                        │
└──────────────────────┬──────────────────────────────┘
                       │
    ┌──────────────────┴──────────────────┐
    │ (mode = d1+vectorize)               │ (mode = d1-only)
    ▼                                     ▼
┌─────────────────────┐          ┌─────────────────────┐
│ 2a. Vectorize ANN   │          │ 2b. D1 Keyword +    │
│  Query embedding     │          │     Cosine Scan     │
│  → Vectorize.query() │          │  Extract terms       │
│  → top 50 candidates │          │  → D1 LIKE queries  │
│                      │          │  → Load embeddings   │
│                      │          │  → In-worker cosine  │
│                      │          │  → top 50 candidates │
└──────────┬──────────┘          └──────────┬──────────┘
           │                                │
           └────────────────┬───────────────┘
                            ▼
┌─────────────────────────────────────────────────────┐
│ 3. Metadata Filter                                   │
│    WHERE subject = ? AND tags LIKE ? etc.            │
│    Also: valid_from <= now, valid_until IS NULL,     │
│          forgotten_at IS NULL (unless opted in)      │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│ 4. Score Combination                                 │
│    For each candidate:                               │
│      similarity = vector_score OR keyword_score       │
│      recency    = decay(now - valid_from)            │
│      confidence = fact.confidence                    │
│      metadata   = filter_match_bonus                 │
│                                                      │
│    final = w_sim * similarity                        │
│          + w_rec * recency                           │
│          + w_con * confidence                        │
│          + w_met * metadata                          │
│                                                      │
│    Default weights:                                  │
│      w_sim = 0.6, w_rec = 0.2,                      │
│      w_con = 0.1, w_met = 0.1                       │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│ 5. Rank, Deduplicate, Threshold, Limit              │
│    Sort by final score desc                          │
│    Deduplicate by supersession chain                 │
│    Filter below threshold                            │
│    Take top N                                        │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│ 6. Cache Result                                      │
│    Store in KV with TTL 300s                         │
│    Return RecallResult[]                             │
└─────────────────────────────────────────────────────┘
```

### Scoring Formula

```ts
function computeScore(
  similarity: number,     // 0.0-1.0 from vector/keyword
  factAge: number,        // milliseconds since valid_from
  confidence: number,     // 0.0-1.0 from fact
  metadataMatch: boolean, // subject/tag filter matched
  halfLifeDays: number    // configurable, default 30
): number {
  // Exponential decay: score halves every `halfLifeDays` days
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
  const recency = Math.pow(0.5, factAge / halfLifeMs)

  const metadataBonus = metadataMatch ? 1.0 : 0.0

  return (
    0.6 * similarity +
    0.2 * recency +
    0.1 * confidence +
    0.1 * metadataBonus
  )
}
```

### D1-Only Keyword Search

When Vectorize is not available, recall falls back to a two-phase search:

**Phase 1: Keyword candidates**
```sql
-- Extract query terms, search fact text
SELECT f.id, f.text, f.subject, f.tags, f.confidence, f.valid_from
FROM facts f
WHERE f.forgotten_at IS NULL
  AND f.valid_until IS NULL
  AND (f.text LIKE '%theme%' OR f.text LIKE '%prefer%' OR f.text LIKE '%dark%' OR f.text LIKE '%mode%')
ORDER BY f.valid_from DESC
LIMIT 200
```

Terms are extracted by splitting the query on whitespace and filtering stop words.

**Phase 2: In-worker cosine similarity (if embeddings exist)**
```ts
// Load embeddings for keyword-matched facts
const embeddings = await db.prepare(
  'SELECT fact_id, vector FROM fact_embeddings WHERE fact_id IN (?...)'
).bind(...candidateIds).all()

// Compute query embedding
const queryEmbedding = await ai.run(embeddingModel, { text: [query] })

// Rank by cosine similarity
const scored = embeddings.map(e => ({
  factId: e.fact_id,
  similarity: cosineSimilarity(queryEmbedding[0], JSON.parse(e.vector))
}))
```

This is a scan-and-rank approach. The `d1ScanLimit` option (default: 500) caps how many embeddings are loaded for cosine comparison. The limit is intentionally conservative because each embedding is ~6KB as JSON — 500 embeddings consume ~3MB of Worker memory. Beyond 500 facts with embeddings, Vectorize mode is strongly recommended.

### Deduplication via Supersession Chain

When a fact is superseded, recall only returns the most recent version in the chain. The chain is followed via `superseded_by`:

```
Fact A ("user likes blue theme") → superseded by Fact B ("user likes dark mode") → superseded by Fact C ("user prefers system theme")
```

Only Fact C appears in recall results (unless `includeSuperseded: true`).

---

## 4. Fact Lifecycle

### Creation

```ts
const result = await memory.remember(
  "User's preferred language is TypeScript",
  {
    subject: 'user',
    tags: ['preferences', 'development'],
    source: 'conversation:2024-03-15',
    confidence: 0.9,
  }
)
// → { ok: true, value: Fact { id: 'fact_V1StGXR8_Z5jdHi', ... } }
```

**Steps:**
1. Check idempotency key (if provided) against `facts` table
2. Generate fact ID (`fact_` + nanoid(16))
3. If `encrypted: true` and encryption key exists, encrypt fact text via `@workkit/crypto.encrypt()`
4. Insert into `facts` table
5. If `supersedes` is set, update the old fact's `superseded_by` and `valid_until`
6. Generate embedding (async, non-blocking if in HTTP context via `waitUntil`)
7. Store embedding in `fact_embeddings` (and Vectorize if available)
8. Invalidate KV recall caches
9. Retry any pending embeddings from previous failures (piggyback, max 5 per call)

### Supersession

Supersession is the primary mechanism for updating facts. Rather than mutating a fact, you create a new one that explicitly replaces it.

```ts
// Direct supersession
const result = await memory.supersede(
  'fact_old123',
  "User's preferred language is Rust",
  { subject: 'user', tags: ['preferences', 'development'] }
)

// Or via remember() with supersedes metadata
const result = await memory.remember(
  "User's preferred language is Rust",
  { supersedes: 'fact_old123', subject: 'user', tags: ['preferences'] }
)
```

**What happens:**
1. Old fact gets `superseded_by = new_fact_id` and `valid_until = now`
2. New fact gets `valid_from = now` and inherits subject/tags from the old fact if not provided
3. Supersession chains are followed during recall to ensure only the latest version appears

### Decay

Facts lose relevance over time via exponential decay. The `decayHalfLifeDays` option (default: 30) controls how quickly:

- At 0 days: recency score = 1.0
- At 30 days: recency score = 0.5
- At 60 days: recency score = 0.25
- At 90 days: recency score = 0.125

This is a scoring signal, not a deletion mechanism. Old facts remain searchable — they just rank lower.

### Compaction

`memory.compact()` merges near-duplicate facts and cleans expired ones.

```ts
const result = await memory.compact({
  mergeThreshold: 0.95,  // Merge facts with >95% embedding similarity
  minAge: 86400,         // Only compact facts older than 1 day
  batchSize: 100,        // Process 100 facts per run
  dryRun: false,
})
```

**Merge logic:**
1. Load batch of facts with embeddings, ordered by `valid_from` ASC
2. For each pair with cosine similarity > threshold: keep the newer fact, mark the older as superseded
3. The newer fact's text is preserved (it's assumed to be more current)

**Expiry cleanup:**
1. Find facts where `created_at + (ttl * 1000) < now`
2. Soft-delete them (set `forgotten_at`, `forgotten_reason = 'expired'`)

### Forgetting

Soft delete — the fact remains in D1 for audit, but is excluded from all queries.

```ts
await memory.forget('fact_V1StGXR8_Z5jdHi', 'user requested deletion')
```

**What happens:**
1. Set `forgotten_at = now`, `forgotten_reason` on the fact row
2. Remove from Vectorize index (if present)
3. Invalidate KV caches
4. The fact is invisible to `recall()`, `search()`, `at()` unless `includeForgotten: true`

### Expiry

Optional TTL on facts. Set at creation or later via `expire()`.

```ts
// At creation
await memory.remember("OAuth token expires in 1 hour", {
  ttl: 3600,  // Expires in 1 hour
  tags: ['auth', 'transient'],
})

// After creation
await memory.expire('fact_abc123', 86400) // Expire in 24 hours
```

Expired facts are cleaned up during `compact()` runs. Between compaction runs, expired facts are filtered out at query time: `WHERE created_at + (ttl * 1000) > :now OR ttl IS NULL`.

---

## 5. Conversation Memory

### Message Storage Format

Each message is stored as a row in the `messages` table. Content is stored as-is (not chunked) — individual messages are bounded by context window limits, so they rarely exceed a few KB.

```ts
const convo = memory.conversation('session-2024-03-15', {
  tokenBudget: 4096,
  compaction: 'summary',
  summaryModel: '@cf/meta/llama-3.1-8b-instruct',
})

// Add messages
await convo.add({ role: 'user', content: 'What is the capital of France?' })
await convo.add({ role: 'assistant', content: 'The capital of France is Paris.' })
await convo.add({ role: 'user', content: 'What about Germany?' })
await convo.add({ role: 'assistant', content: 'The capital of Germany is Berlin.' })
```

### Token Counting

Every message gets `token_count` computed via `@workkit/ai.estimateTokens()` at insertion time. This is an estimate, not an exact count — but it's computed synchronously without an API call, which matters for the hot path.

### Auto-Compaction Strategies

When `conversation.get()` is called, the compaction strategy determines what messages are returned within the token budget.

**1. Sliding Window** (`compaction: 'sliding-window'`)

Keep the most recent `windowSize` messages. Oldest messages beyond the window are available via `conversation.messages()` but not included in `get()`.

```ts
const convo = memory.conversation('session-1', {
  compaction: 'sliding-window',
  windowSize: 50,       // Keep last 50 messages
  tokenBudget: 4096,    // But also respect token budget
})

const snapshot = await convo.get()
// Returns last N messages that fit in 4096 tokens (up to 50)
```

**2. Token Budget** (`compaction: 'token-budget'`)

Keep as many recent messages as fit in the token budget. No fixed window size.

```ts
const convo = memory.conversation('session-1', {
  compaction: 'token-budget',
  tokenBudget: 8192,
})

const snapshot = await convo.get()
// Returns most recent messages fitting in 8192 tokens
```

**3. Summary Compaction** (`compaction: 'summary'`)

When messages exceed the token budget, older messages are summarized via LLM and replaced with a summary. The most powerful strategy.

```ts
const convo = memory.conversation('session-1', {
  compaction: 'summary',
  tokenBudget: 4096,
  summaryModel: '@cf/meta/llama-3.1-8b-instruct',
})

const snapshot = await convo.get()
// Returns: [summary of old messages] + [recent messages within budget]
```

**Summary compaction flow:**
1. On `get()`, check if total active message tokens exceed `tokenBudget * 1.5` (compaction trigger)
2. If triggered, **return the uncompacted result immediately** (truncated to token budget via sliding window) and trigger compaction **asynchronously** via `ctx.waitUntil()`. This avoids blocking `get()` on an LLM summarization call (~1-3s latency).
3. The async compaction: selects messages from oldest until `tokenBudget * 0.5` worth of tokens, calls `summarize()` via Workers AI, stores the summary, marks compacted messages.
4. On the next `get()` call, the compacted summaries are available and served inline.

**Explicit compaction:** For cases where you need compaction to complete synchronously (e.g., before archiving), use the explicit `compact()` method:

```ts
// Force synchronous compaction
await convo.compact()
// Now get() returns fully compacted results
const snapshot = await convo.get()
```

**Summarization prompt:**
```
Summarize the following conversation segment concisely. Preserve:
- Key decisions and conclusions
- Important facts mentioned
- User preferences expressed
- Action items and commitments
- Names, dates, and specific values

Conversation:
{messages}

Summary:
```

### Summary Storage and Retrieval

Summaries are stored in the `summaries` table and linked to the messages they cover.

```ts
const snapshot = await convo.get()
snapshot.summaries   // Array of Summary objects (older compacted history)
snapshot.messages    // Array of StoredMessage (recent, active messages)
snapshot.totalTokens // Combined token count
```

When building LLM context from a conversation snapshot:
```ts
const context = [
  // Summaries first (oldest history, compressed)
  ...snapshot.summaries.map(s => ({
    role: 'system' as const,
    content: `[Previous conversation summary]: ${s.content}`
  })),
  // Then active messages (recent history, full fidelity)
  ...snapshot.messages.map(m => ({
    role: m.role,
    content: m.content,
  })),
]
```

### Multi-Turn Conversation Threading

Conversations are identified by string IDs. The application decides the granularity:
- Per-session: `conversation('session-abc123')`
- Per-user: `conversation('user-42')`
- Per-topic: `conversation('topic-deployment-2024')`

There is no built-in hierarchy (threads within conversations). If needed, use naming conventions: `conversation('session-abc/thread-deploy')`.

---

## 6. Edge Cases & Error Handling

### Embedding Generation Failure

**Scenario:** Workers AI returns a 429 (rate limit) or 500 during embedding generation.

**Handling:**
```ts
// remember() stores the fact immediately, marks embedding as pending
INSERT INTO facts (..., embedding_status) VALUES (..., 'pending')

// On the next remember() call, piggyback retry:
SELECT id, text FROM facts WHERE embedding_status = 'pending' LIMIT 5
// Batch-embed these alongside the new fact
// On success: UPDATE facts SET embedding_status = 'complete' WHERE id = ?
// On failure: UPDATE facts SET embedding_status = 'failed' WHERE id = ? (after 3 retries)
```

**User impact:** Fact is stored and searchable via keyword. Semantic search will miss it until embedding succeeds. `stats()` reports `pendingEmbeddings` count.

### D1 Query Timeout on Large Memory Stores

**Scenario:** D1 query takes too long on 100K+ facts.

**Handling:**
- All list queries use pagination (default `LIMIT 100`, max `LIMIT 1000`)
- `d1ScanLimit` option caps cosine similarity scan to 500 facts (configurable) — conservative default due to memory pressure from loading embedding arrays
- Indexes on `subject`, `tags`, `valid_from`, `forgotten_at` accelerate WHERE clauses
- D1-only mode with >10K facts logs a warning suggesting Vectorize upgrade
- `recall()` uses a 5-second query timeout (D1's default). On timeout, returns partial results with a warning in the error channel

### Vectorize Index Not Yet Created

**Scenario:** User passes `vectorize` binding but the index doesn't exist or has wrong dimensions.

**Handling:**
```ts
// On first remember(), test the Vectorize binding:
try {
  await vectorize.query(testVector, { topK: 1 })
  this.mode = 'd1+vectorize'
} catch (e) {
  logger.warn('Vectorize unavailable, falling back to D1-only', { error: e.message })
  this.mode = 'd1-only'
  // Store the error — don't retry every call
  this.vectorizeFailed = true
}
```

The mode is sticky for the lifetime of the `Memory` instance. If Vectorize was unavailable at creation, D1-only mode is used for all operations. The next Worker invocation (new instance) will retry.

### KV Cache Staleness After `remember()`

**Scenario:** Worker A calls `remember()` and bumps the cache generation. Worker B reads stale cache from the old generation before KV propagates the new generation counter.

**Handling:**
- KV is eventually consistent. Cache TTL of 300s bounds staleness.
- `recall()` accepts `noCache: true` for when freshness matters
- `remember()` bumps the `memory:gen` counter — a single `put()` call. Old-generation cache keys expire naturally via TTL.
- For multi-Worker deployments, the 300s TTL is the real consistency boundary. This is acceptable for agent memory (agents don't need sub-second consistency on recall).

### Concurrent `remember()` — Idempotency

**Scenario:** Two Workers store the same fact simultaneously.

**Handling:**
- If `idempotencyKey` is provided, a UNIQUE constraint on `idempotency_key` in the `facts` table prevents duplicates. The second write gets a `MemoryIdempotencyError`.
- If no idempotency key, both facts are stored. This is by design — the same text from different sources at different times is a valid scenario. Use `compact()` to merge near-duplicates later.

### Conversation Too Long for Single D1 Row

**Non-issue:** Messages are stored as individual rows (one row per message), not as a single conversation blob. D1 rows have a 10MB limit — no individual message should approach this. If a single message exceeds 1MB, it's stored but triggers a warning log. Applications should chunk large content before adding to conversations.

### Embedding Model Changes

**Scenario:** User switches from `bge-base-en-v1.5` to a different model.

**Handling:**
```ts
const result = await memory.reembed({
  force: true,     // Re-embed all facts, not just pending
  batchSize: 50,   // 50 per run (Workers AI rate limits)
})
```

- `reembed({ force: true })` clears all embeddings and regenerates them
- In Vectorize mode, this also re-upserts all vectors (the old vectors with wrong dimensions will error — the Vectorize index must be recreated with the new dimensions)
- Migration path: create new Vectorize index → update config → run `reembed()` → delete old index
- D1-stored embeddings are always the source of truth. Vectorize is a search acceleration layer that can be rebuilt.

### PII in Memories

**Scenario:** Agent stores facts about users that contain personally identifiable information.

**Handling:**
```ts
await memory.remember(
  "User's email is bikash@example.com",
  { encrypted: true, subject: 'user', tags: ['pii', 'contact'] }
)
```

- When `encrypted: true` and `encryptionKey` is configured, fact text is encrypted via `@workkit/crypto.encrypt()` before D1 storage
- Encrypted facts have `encrypted = 1` in D1
- On read, facts are transparently decrypted
- Embeddings are generated from the PLAINTEXT (before encryption) — otherwise semantic search wouldn't work. This is a deliberate tradeoff: embeddings are lossy (you can't reconstruct the text from an embedding), but they do leak semantic information. For maximum security, don't generate embeddings for PII facts (pass a `skipEmbedding: true` flag in metadata).
- KV cache stores decrypted results. If KV security is a concern, disable caching for encrypted facts.

### Memory Pressure: D1 Capacity

**Estimates per fact (average):**
- `facts` row: ~500 bytes (text + metadata + indexes)
- `fact_embeddings` row: ~6.2 KB (768 float32s as JSON ≈ 6144 bytes + overhead)
- Vectorize vector: ~3 KB (768 float32s binary)

**Capacity at D1's 10GB limit:**

| Facts | facts table | embeddings table | Total D1 | Vectorize |
|-------|-------------|------------------|----------|-----------|
| 1K | ~0.5 MB | ~6 MB | ~7 MB | ~3 MB |
| 10K | ~5 MB | ~62 MB | ~67 MB | ~30 MB |
| 100K | ~50 MB | ~620 MB | ~670 MB | ~300 MB |
| 500K | ~250 MB | ~3.1 GB | ~3.35 GB | ~1.5 GB |
| 1M | ~500 MB | ~6.2 GB | ~6.7 GB | ~3 GB |

D1 comfortably holds up to ~1M facts with embeddings within the 10GB limit. Beyond that, consider partitioning by subject or time range into multiple D1 databases.

**Optimization:** Store embeddings as binary blobs instead of JSON arrays. A 768-dim float32 vector is 3072 bytes as binary vs ~6144 as JSON. The schema below uses TEXT (JSON) for simplicity and debuggability, but a BLOB column halves embedding storage.

### Workers AI Rate Limits

**Scenario:** Bulk `rememberBatch()` of 500 facts hits Workers AI embedding rate limits.

**Handling:**
- Workers AI embedding endpoint accepts batches of up to 100 texts
- `rememberBatch()` chunks into batches of 100, with 100ms delay between batches
- If a batch fails with 429, remaining facts are stored with `embedding_status = 'pending'`
- `reembed()` processes pending facts in batches of `batchSize` (default 50) with backoff
- The `@workkit/ai.withRetry()` utility handles per-request retries (3 attempts, exponential backoff)

### Multilingual Content

**Scenario:** Agent stores facts in multiple languages.

**Handling:**
- Default model (`bge-base-en-v1.5`) is optimized for English but handles other languages reasonably
- For true multilingual support, configure `embeddingModel: '@cf/baai/bge-m3'` (multilingual, same dimensions)
- The `embeddingModel` option at the factory level applies to all facts
- Model change requires `reembed({ force: true })` for existing facts
- Keyword search in D1-only mode uses `LIKE` which is language-agnostic but tokenization-unaware

---

## 7. D1 Schema Design

### Tables

```sql
-- ─── Facts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facts (
  id              TEXT PRIMARY KEY,
  text            TEXT NOT NULL,
  subject         TEXT,
  source          TEXT,
  tags            TEXT,               -- JSON array: '["pref","dev"]'
  confidence      REAL NOT NULL DEFAULT 1.0,
  encrypted       INTEGER NOT NULL DEFAULT 0,
  embedding_status TEXT NOT NULL DEFAULT 'pending', -- 'complete' | 'pending' | 'failed'
  valid_from      INTEGER NOT NULL,   -- Unix ms
  valid_until     INTEGER,            -- Unix ms, NULL = still valid
  superseded_by   TEXT,               -- FK to facts.id
  forgotten_at    INTEGER,            -- Unix ms, NULL = not forgotten
  forgotten_reason TEXT,
  ttl             INTEGER,            -- Seconds, NULL = no expiry
  idempotency_key TEXT,               -- Unique constraint for dedup
  created_at      INTEGER NOT NULL,   -- Unix ms
  updated_at      INTEGER NOT NULL    -- Unix ms
);

CREATE INDEX idx_facts_subject ON facts(subject) WHERE forgotten_at IS NULL;
CREATE INDEX idx_facts_valid_from ON facts(valid_from) WHERE forgotten_at IS NULL;
CREATE INDEX idx_facts_embedding_status ON facts(embedding_status) WHERE embedding_status != 'complete';
CREATE INDEX idx_facts_superseded_by ON facts(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX idx_facts_ttl ON facts(created_at, ttl) WHERE ttl IS NOT NULL;
CREATE UNIQUE INDEX idx_facts_idempotency ON facts(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Full-text search index for keyword recall (D1 supports FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  text,
  subject,
  tags,
  content='facts',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync.
-- NOTE: Encrypted facts (encrypted = 1) are EXCLUDED from FTS indexing because
-- their stored text is ciphertext, not searchable plaintext. Encrypted facts
-- use vector/metadata search only (embeddings are generated from plaintext
-- before encryption — see PII section in Edge Cases).
CREATE TRIGGER facts_ai AFTER INSERT ON facts WHEN new.encrypted = 0 BEGIN
  INSERT INTO facts_fts(rowid, text, subject, tags) VALUES (new.rowid, new.text, new.subject, new.tags);
END;
CREATE TRIGGER facts_ad AFTER DELETE ON facts WHEN old.encrypted = 0 BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, text, subject, tags) VALUES('delete', old.rowid, old.text, old.subject, old.tags);
END;
CREATE TRIGGER facts_au AFTER UPDATE ON facts WHEN old.encrypted = 0 OR new.encrypted = 0 BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, text, subject, tags) VALUES('delete', old.rowid, old.text, old.subject, old.tags);
  INSERT INTO facts_fts(rowid, text, subject, tags) SELECT new.rowid, new.text, new.subject, new.tags WHERE new.encrypted = 0;
END;

-- ─── Fact Embeddings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_embeddings (
  fact_id    TEXT PRIMARY KEY REFERENCES facts(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,           -- e.g. '@cf/baai/bge-base-en-v1.5'
  dimensions INTEGER NOT NULL,        -- e.g. 768
  vector     TEXT NOT NULL,           -- JSON array of float32
  created_at INTEGER NOT NULL
);

-- ─── Fact Edges (RESERVED FOR v2 — not included in initial migration) ───
-- Explicit relationships between facts (beyond supersession).
-- Design preserved here for future reference. Will be added via migration
-- when graph-based recall is implemented.
--
-- CREATE TABLE IF NOT EXISTS fact_edges (
--   id        TEXT PRIMARY KEY,
--   from_id   TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
--   to_id     TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
--   relation  TEXT NOT NULL,            -- 'related' | 'contradicts' | 'supports' | 'derived_from'
--   weight    REAL NOT NULL DEFAULT 1.0,
--   created_at INTEGER NOT NULL
-- );
--
-- CREATE INDEX idx_fact_edges_from ON fact_edges(from_id);
-- CREATE INDEX idx_fact_edges_to ON fact_edges(to_id);
-- CREATE UNIQUE INDEX idx_fact_edges_pair ON fact_edges(from_id, to_id, relation);

-- ─── Conversations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  metadata   TEXT,                    -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ─── Messages ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,       -- 'system' | 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL,
  name            TEXT,                -- Tool name or user name
  metadata        TEXT,                -- JSON object
  token_count     INTEGER NOT NULL,
  compacted_into  TEXT,                -- FK to summaries.id, NULL = active
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_active ON messages(conversation_id, compacted_into) WHERE compacted_into IS NULL;

-- ─── Summaries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  message_from    TEXT NOT NULL,       -- First message ID in range
  message_to      TEXT NOT NULL,       -- Last message ID in range
  message_count   INTEGER NOT NULL,
  original_tokens INTEGER NOT NULL,
  summary_tokens  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_summaries_conversation ON summaries(conversation_id, created_at);
```

### Migration Strategy

Migrations are versioned SQL files applied in order. The memory system checks a `_memory_migrations` table on first access:

```sql
CREATE TABLE IF NOT EXISTS _memory_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

On `createMemory()`, the factory:
1. Checks `_memory_migrations` for the current version
2. Applies any pending migrations in order
3. Records applied migrations

Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Schema changes in future versions use `ALTER TABLE` where possible, or migration scripts that copy data.

### Size Estimates

| Scale | facts | fact_embeddings | messages (avg 1K/convo) | Total D1 |
|-------|-------|-----------------|------------------------|----------|
| 1K facts, 10 convos | 0.5 MB | 6 MB | 2 MB | ~9 MB |
| 10K facts, 50 convos | 5 MB | 62 MB | 10 MB | ~77 MB |
| 100K facts, 200 convos | 50 MB | 620 MB | 40 MB | ~710 MB |

D1's 10GB limit is comfortable for all but the largest deployments. The embedding table dominates storage — switching to BLOB encoding (discussed in Section 6) would halve it.

---

## 8. Testing

### Mock Memory

`@workkit/testing` provides a `createMockMemory()` that implements the full `Memory` interface with in-memory storage. No D1, KV, or Workers AI needed.

```ts
import { createMockMemory } from '@workkit/testing'

const memory = createMockMemory()

// Works identically to real memory
await memory.remember('User prefers dark mode', { subject: 'user' })
const results = await memory.recall('theme preference')
expect(results.value[0].fact.text).toBe('User prefers dark mode')

// Inspect internal state
expect(memory._facts).toHaveLength(1)
expect(memory._embeddings).toHaveLength(0) // No Workers AI = no embeddings
```

**Mock behavior:**
- `remember()` stores facts in an in-memory array
- `recall()` uses simple string matching (includes/indexOf) instead of embeddings
- `conversation()` works fully (in-memory message storage, token counting)
- `at()` filters in-memory facts by timestamp
- `stats()` returns counts from in-memory arrays
- `compact()` is a no-op that returns zeroed results
- No KV caching, no embedding generation, no encryption

### Seed Builders

```ts
import { createMockMemory, seedMemory } from '@workkit/testing'

const memory = createMockMemory()

// Seed with facts
await seedMemory(memory, {
  facts: [
    { text: 'User name is Alice', subject: 'user', tags: ['identity'] },
    { text: 'Project uses TypeScript', subject: 'project', tags: ['tech'] },
    { text: 'Deployment target is Cloudflare', subject: 'project', tags: ['infra'] },
  ],
  conversations: {
    'session-1': [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi! How can I help?' },
    ],
  },
})
```

### Testing Recall Relevance (Golden Set Evaluation)

For testing that recall returns the right facts, provide a golden set:

```ts
import { evaluateRecall } from '@workkit/memory/testing'

const goldenSet = [
  {
    query: 'what language does the project use',
    expectedFactIds: ['fact-ts'],    // Must appear in top results
    unexpectedFactIds: ['fact-name'], // Must NOT appear in top results
  },
  {
    query: 'who is the user',
    expectedFactIds: ['fact-name'],
    unexpectedFactIds: ['fact-ts'],
  },
]

const evaluation = await evaluateRecall(memory, goldenSet)
// {
//   precision: 0.95,    // % of returned results that were expected
//   recall: 1.0,        // % of expected results that were returned
//   mrr: 0.9,           // Mean reciprocal rank of first expected result
//   details: [...]      // Per-query breakdown
// }
```

This is useful for:
- Validating recall quality after embedding model changes
- Regression testing after scoring formula adjustments
- Comparing D1-only vs D1+Vectorize quality

---

## 9. Integration with @workkit/mcp

### `memory.inject()` Middleware

`inject()` returns a middleware function that pre-loads relevant memory into the context before a tool executes. This is how memory integrates with MCP tool servers.

```ts
import { createMemory } from '@workkit/memory'
import { createMCP } from '@workkit/mcp'

const memory = createMemory({ db: env.DB, cache: env.KV, embeddings: env.AI })
const mcp = createMCP()

// Inject memory context into all tools
mcp.use(memory.inject({
  tokenBudget: 1024,
  queryResolver: (input) => {
    // Extract the user's message from tool input
    if (typeof input === 'string') return input
    if (input && typeof input === 'object' && 'message' in input) return (input as any).message
    return ''
  },
  subjectResolver: (input) => {
    if (input && typeof input === 'object' && 'userId' in input) return `user:${(input as any).userId}`
    return undefined
  },
  tags: ['context'],
}))

// Tools receive memory context in their execution context
mcp.tool('answer', async (input, context) => {
  // context.memory contains pre-loaded relevant facts
  const facts = context.memory // RecallResult[]
  // Use these facts to ground the response
})
```

### How Subject Resolution Works

The `subjectResolver` function extracts a subject from the tool input. This is used to filter recall results — if the tool is operating on a specific user or entity, only facts about that entity are injected.

Resolution priority:
1. `subjectResolver(input)` if provided and returns non-null
2. Implicit subject from conversation context (if conversation ID is in the input)
3. No subject filter (all facts considered)

### Token Budget for Injected Context

The `tokenBudget` (default: 1024 tokens) limits how much memory context is injected. This prevents memory from consuming the entire LLM context window.

Budget allocation:
1. Recall top facts until token budget is reached (using `estimateTokens()`)
2. Format as a system-level context block:

```
[Relevant memory]
- User prefers dark mode (confidence: 0.9, 2 days ago)
- Project deploys to Cloudflare Workers (confidence: 1.0, 5 days ago)
[End memory]
```

3. If no relevant facts found (all below threshold), no context is injected (zero token cost)

---

## 10. Performance

### Expected Latency

| Operation | D1-Only | D1+Vectorize | KV Cached |
|-----------|---------|--------------|-----------|
| `remember()` (with embedding) | 150-300ms | 150-350ms | N/A |
| `remember()` (no embedding) | 5-15ms | 5-15ms | N/A |
| `recall()` (10K facts) | 100-300ms | 30-80ms | 2-5ms |
| `recall()` (100K facts) | 500-2000ms* | 30-80ms | 2-5ms |
| `search()` (keyword, paginated) | 10-50ms | 10-50ms | N/A |
| `get()` (by ID) | 5-10ms | 5-10ms | 1-3ms |
| `conversation.add()` | 5-15ms | 5-15ms | N/A |
| `conversation.get()` (no compaction) | 10-30ms | 10-30ms | N/A |
| `conversation.get()` (with summary) | 500-2000ms | 500-2000ms | N/A |
| `forget()` | 10-20ms | 15-30ms | N/A |
| `compact()` (100 facts) | 1-5s | 1-5s | N/A |

*D1-only at 100K facts involves scanning `d1ScanLimit` embeddings for cosine similarity. This is where Vectorize mode becomes essential.

### KV Cache Hit Rates

For typical agent workloads (repeat queries, common topics):
- **Recall cache:** 40-60% hit rate (agents re-ask similar questions frequently)
- **Fact cache:** 70-90% hit rate (specific facts are referenced repeatedly)
- **Stats cache:** 95%+ hit rate (stats change slowly)

Cache effectiveness depends on workload. A high-throughput agent with diverse queries will see lower hit rates. The 300s TTL ensures staleness is bounded.

### D1 Query Optimization

**FTS5 for keyword search:**
The `facts_fts` virtual table uses SQLite FTS5 for fast full-text search in D1-only mode. This replaces naive `LIKE` queries with proper tokenized search:

```sql
-- Instead of:  WHERE text LIKE '%theme%' AND text LIKE '%prefer%'
-- Use:         SELECT * FROM facts_fts WHERE facts_fts MATCH 'theme prefer'
```

FTS5 with `MATCH` is orders of magnitude faster than `LIKE` for keyword queries and supports ranking via `bm25()`.

**Index coverage:**
The indexes are designed for the most common query patterns:
- `idx_facts_subject` — recall filtered by subject (WHERE subject = ? AND forgotten_at IS NULL)
- `idx_facts_valid_from` — temporal queries and recency sorting
- `idx_facts_embedding_status` — finding pending embeddings for retry (partial index)
- `idx_messages_active` — conversation get() skipping compacted messages

### Batch Operations

```ts
// Bulk remember — uses batch embedding and D1 batch insert
const results = await memory.rememberBatch([
  { fact: 'Fact 1', metadata: { subject: 'project' } },
  { fact: 'Fact 2', metadata: { subject: 'project' } },
  { fact: 'Fact 3', metadata: { subject: 'user' } },
])
// Single Workers AI call (batch embed), single D1 batch insert

// Bulk recall — parallel D1 queries
// (Not a separate API — use Promise.all with individual recall calls)
const [userPrefs, projectContext] = await Promise.all([
  memory.recall('user preferences', { subject: 'user', limit: 5 }),
  memory.recall('project setup', { subject: 'project', limit: 5 }),
])
```

**Batch `remember()` implementation:**
1. Validate all facts
2. Generate IDs for all facts
3. Call Workers AI with all texts in a single batch (up to 100, chunked if more)
4. Use D1 batch API to insert all facts + embeddings in one round-trip
5. Upsert all vectors to Vectorize in one call (if available)
6. Invalidate KV caches once

This reduces a 100-fact bulk insert from ~100 D1 round-trips + ~100 AI calls to ~1 D1 batch + ~1 AI call.

---

## Usage Examples

### Basic Agent Memory

```ts
import { createMemory } from '@workkit/memory'
import { Hono } from 'hono'

const app = new Hono<{ Bindings: { DB: D1Database; KV: KVNamespace; AI: Ai } }>()

app.post('/chat', async (c) => {
  const memory = createMemory({
    db: c.env.DB,
    cache: c.env.KV,
    embeddings: c.env.AI,
  })

  const { message } = await c.req.json()

  // Recall relevant context
  const context = await memory.recall(message, { limit: 5 })

  // Extract facts from conversation and remember them
  // (this would typically happen in a post-processing step)
  await memory.remember('User asked about deployment options', {
    subject: 'user',
    tags: ['interests'],
    source: 'conversation',
  })

  return c.json({ context: context.value })
})
```

### Conversation with Auto-Compaction

```ts
app.post('/chat/:sessionId', async (c) => {
  const memory = createMemory({ db: c.env.DB, embeddings: c.env.AI })
  const convo = memory.conversation(c.req.param('sessionId'), {
    tokenBudget: 4096,
    compaction: 'summary',
    summaryModel: '@cf/meta/llama-3.1-8b-instruct',
  })

  const { message } = await c.req.json()

  // Add user message
  await convo.add({ role: 'user', content: message })

  // Get conversation with auto-compaction
  const snapshot = await convo.get()
  // snapshot.summaries = compressed history
  // snapshot.messages = recent messages
  // snapshot.totalTokens <= 4096

  // ... call LLM with snapshot as context ...

  // Add assistant response
  await convo.add({ role: 'assistant', content: response })

  return c.json({ response })
})
```

### Temporal Debugging

```ts
// What did the agent know at noon yesterday?
const yesterday = memory.at(Date.now() - 86400000)
const knownFacts = await yesterday.search('', { subject: 'project', limit: 100 })
// Returns only facts that were valid at that timestamp
```

### Progressive Enhancement

```ts
// Minimal — D1 only, keyword search
const basic = createMemory({ db: env.DB })

// Better — add KV cache
const cached = createMemory({ db: env.DB, cache: env.KV })

// Better — add embeddings (semantic search in D1)
const semantic = createMemory({ db: env.DB, cache: env.KV, embeddings: env.AI })

// Best — add Vectorize (production vector search)
const full = createMemory({
  db: env.DB,
  cache: env.KV,
  embeddings: env.AI,
  vectorize: env.VECTORIZE_INDEX,
})

// All four use the same API. recall() quality improves with each tier.
```

---

## Open Questions

1. **Binary vs JSON embeddings in D1:** JSON is debuggable but 2x the storage. Should we default to BLOB and provide a debug mode?
2. **Cross-conversation fact extraction:** Should `conversation.add()` automatically extract facts? This would couple conversation and fact memory tightly.
3. **Fact conflict resolution:** When two facts contradict each other (detected via `fact_edges` with `contradicts` relation), should `recall()` surface only the higher-confidence one, or flag the contradiction?
4. **Vectorize namespace isolation:** If multiple memory instances share a Vectorize index, how do we isolate? Namespace prefix on vector IDs, or require separate indexes?
5. **FTS5 availability in D1:** D1 is built on SQLite and supports FTS5 today. If this changes, the fallback is `LIKE` queries (already implemented as the baseline). Monitor Cloudflare's D1 changelog.
