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
for (const sql of getSchema()) await env.DB.exec(sql);
```

## Quick start

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

await memory.remember("Alice prefers dark mode", {
  subject: "user:alice",
  tags: ["preferences", "ui"],
  confidence: 0.95,
});

const results = await memory.recall("what does alice prefer", {
  subject: "user:alice",
  limit: 5,
});
```

## Facts

A `Fact` has rich metadata:

```ts
type Fact = {
  id: string;
  text: string;
  subject?: string;        // owner / scope
  source?: string;         // provenance
  tags?: string[];
  confidence?: number;     // 0..1
  encrypted?: boolean;
  createdAt: number;
  validFrom?: number;
  validUntil?: number;
  supersededBy?: string;
  forgottenAt?: number;
  embeddingStatus: "pending" | "ready" | "failed";
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
  compaction: "summary",
  summaryModel: "@cf/meta/llama-3.1-8b-instruct",
});

await conv.add({ role: "user", content: "Plan a trip to Tokyo" });
await conv.add({ role: "assistant", content: "..." });

const window = await conv.get({ format: "messages" });
```

Compaction strategies: `sliding-window`, `token-budget`, `summary`. The `summary` strategy uses Workers AI to compress older turns into a summary message that stays in the context.

## Encryption

```ts
import { generateEncryptionKey } from "@workkit/crypto";

const memory = createMemory({
  db: env.DB,
  encryptionKey: await generateEncryptionKey(env.MEMORY_KEY_MATERIAL),
});

await memory.remember("Alice's SSN is ...", { encrypted: true });
```

Encrypted facts are AES-GCM at rest. Only callers with the `encryptionKey` can decrypt — recall transparently decrypts if the key is present, returns ciphertext placeholder otherwise.

## Maintenance

```ts
// Drop facts past their validUntil and forgotten facts older than 30 days
await memory.compact({ olderThan: "30d", dryRun: false });

// Backfill embeddings for facts that arrived without Vectorize wired up
await memory.reembed({ status: "pending", limit: 1000 });

// Stats for ops dashboards
const { totalFacts, byStatus, vectorBacklog } = await memory.stats();
```

## Errors

Memory operations return `MemoryResult<T>` (a discriminated union) for storage paths. Errors carry codes: `STORAGE_ERROR`, `EMBEDDING_ERROR`, `VECTORIZE_ERROR`, `CACHE_ERROR`, `ENCRYPTION_ERROR`, `COMPACTION_ERROR`, `NOT_FOUND`, `IDEMPOTENCY_ERROR`.

## See also

- [Agents](/workkit/guides/agents/) — pair with `@workkit/agent` to inject recalled facts into the model context.
- [AI Integration](/workkit/guides/ai-integration/) — Workers AI bindings for embeddings.
- [Database](/workkit/guides/database/) — D1 patterns used by the storage layer.
