---
title: "Agent Memory"
---

# Agent Memory

`@workkit/memory` is edge-native memory for AI agents on Cloudflare Workers — fact storage with temporal decay, vector recall via Vectorize, and conversation threads with token budgeting and auto-summarization. D1 is the only required binding; KV, Workers AI, and Vectorize are opt-in.

## Install

```bash
bun add @workkit/memory @workkit/errors
```

## Bindings

| Binding | Purpose | Required |
|---|---|---|
| `D1Database` | Fact + conversation storage | Yes |
| `KVNamespace` | Recall result cache | No |
| `Ai` (Workers AI) | Embedding generation | No |
| `VectorizeIndex` | Vector similarity search | No |

Without `Ai` + `Vectorize`, `recall()` falls back to keyword search over the D1 facts table.

## Schema

Run the D1 schema once in your migrations:

```ts
import { getSchema } from "@workkit/memory";
await env.DB.exec(getSchema());
```

## Quick start

Every storage method returns a `MemoryResult<T>` discriminated union — `{ ok: true; value }` on success, `{ ok: false; error }` otherwise. Always branch on `.ok`.

```ts
import { createMemory } from "@workkit/memory";

const memory = createMemory({
  db: env.DB,
  cache: env.CACHE_KV,
  embeddings: env.AI,
  vectorize: env.VECTORIZE,
  embeddingModel: "@cf/baai/bge-base-en-v1.5",
  decayHalfLifeDays: 30,
});

const stored = await memory.remember("Alice prefers dark mode", {
  subject: "user:alice",
  tags: ["preferences", "ui"],
  confidence: 0.95,
});
if (!stored.ok) throw new Error(stored.error.message);

const recalled = await memory.recall("what does alice prefer", {
  subject: "user:alice",
  limit: 5,
});
if (recalled.ok) {
  for (const result of recalled.value) {
    console.log(result.fact.text, result.score);
  }
}
```

## Facts

A `Fact` has rich metadata. Most fields are non-optional but explicitly nullable:

```ts
type Fact = {
  id: string;
  text: string;
  subject: string | null;        // owner / scope
  source: string | null;         // provenance
  tags: string[];
  confidence: number;            // 0..1
  encrypted: boolean;
  createdAt: number;
  validFrom: number;
  validUntil: number | null;
  supersededBy: string | null;
  forgottenAt: number | null;
  forgottenReason: string | null;
  embeddingStatus: "complete" | "pending" | "failed";
  ttl: number | null;
};
```

`forget(id, reason)` and `supersede(oldId, newFact)` are soft operations — the row stays for audit but recall skips it.

## Recall scoring

Each candidate gets a composite score:

| Signal | Default weight |
|---|---|
| Embedding cosine similarity | 0.5 |
| Recency (exponential decay) | 0.2 |
| Confidence | 0.15 |
| Tag overlap | 0.1 |
| Source priority | 0.05 |

Tune via `RecallOptions.weights`. The top-k results return with the score breakdown attached.

## Temporal queries

```ts
const past = memory.at(Date.parse("2026-01-01"));
const factsAsOfThen = await past.recall("user preferences");
```

`at(timestamp)` scopes recall to facts that were valid at that point in time (uses `validFrom` / `validUntil` / `supersededBy`).

## Conversations

```ts
const conv = memory.conversation("thread-42", {
  tokenBudget: 8000,
});

await conv.add({ role: "user", content: "Plan a trip to Tokyo" });
await conv.add({ role: "assistant", content: "..." });

const snapshot = await conv.get({ tokenBudget: 4000, includeCompacted: false });
if (snapshot.ok) {
  for (const message of snapshot.value.messages) {
    console.log(message.role, message.content);
  }
}
```

`Conversation.get(options?)` accepts `{ tokenBudget?, includeCompacted? }` and returns `MemoryResult<ConversationSnapshot>`. List individual messages with `messages(options?)`.

> **v0.1.0 limitation:** `summarize()` currently returns `{ ok: false, error: { code: "COMPACTION_ERROR", message: "Summary compaction not yet implemented" } }`. Conversation compaction is on the roadmap; track via the package CHANGELOG.

## Encryption

```ts
import { generateKey, exportKey, importKey } from "@workkit/crypto";

// Generate once, persist exported base64 as a secret
const key = await importKey(env.MEMORY_KEY_BASE64);

const memory = createMemory({
  db: env.DB,
  encryptionKey: key,
});

await memory.remember("Alice's SSN is ...", { encrypted: true });
```

Encrypted facts are AES-256-GCM at rest. `encryptionKey` must be a `CryptoKey` — generate one with `generateKey()`, export to base64 with `exportKey()`, store as a Worker secret, then re-hydrate with `importKey()`.

## Maintenance

```ts
// Run TTL-based cleanup of expired facts
const compact = await memory.compact({ batchSize: 500, dryRun: false });

// Backfill embeddings for facts whose embeddingStatus is "pending"
const reembed = await memory.reembed({ batchSize: 100 });

// Stats for ops dashboards
const stats = await memory.stats();
if (stats.ok) console.log(stats.value);
```

`compact()` in v0.1.0 performs TTL-based expiry only — `mergedCount` returns 0 until merging lands. `reembed()` requires the `embeddings` (Workers AI) binding; otherwise it returns `{ ok: false, error: { code: "EMBEDDING_ERROR", message: "No AI binding configured" } }`. Every `MemoryError` carries both `code` and `message` — branch on the code, log the message.

## Errors

Memory operations return `MemoryResult<T>` (a discriminated union) for storage paths. Errors carry codes: `STORAGE_ERROR`, `EMBEDDING_ERROR`, `VECTORIZE_ERROR`, `CACHE_ERROR`, `ENCRYPTION_ERROR`, `COMPACTION_ERROR`, `NOT_FOUND`, `IDEMPOTENCY_ERROR`.

## See also

- [Agents](/workkit/guides/agents/) — pair with `@workkit/agent` to inject recalled facts into the model context.
- [AI Integration](/workkit/guides/ai-integration/) — Workers AI bindings for embeddings.
- [Database](/workkit/guides/database/) — D1 patterns used by the storage layer.
