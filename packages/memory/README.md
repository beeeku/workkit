# @workkit/memory

> Edge-native agent memory for Cloudflare Workers — facts with temporal decay, vector recall, conversation threads, optional encryption.

[![npm](https://img.shields.io/npm/v/@workkit/memory)](https://www.npmjs.com/package/@workkit/memory)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/memory)](https://bundlephobia.com/package/@workkit/memory)

D1 is the only required binding. Workers AI (embeddings) and Vectorize (vector search) are opt-in — without them, recall falls back to keyword search over D1.

## Install

```bash
bun add @workkit/memory @workkit/errors
```

## Usage

```ts
import { createMemory, getSchema } from "@workkit/memory";

// Run schema once during migrations
await env.DB.exec(getSchema());

const memory = createMemory({
  db: env.DB,
  cache: env.CACHE_KV,
  embeddings: env.AI,
  vectorize: env.VECTORIZE,
  decayHalfLifeDays: 30,
});

const stored = await memory.remember("Alice prefers dark mode", {
  subject: "user:alice",
  tags: ["preferences"],
  confidence: 0.95,
});
if (!stored.ok) throw new Error(stored.error.message);

const recalled = await memory.recall("what does alice prefer", { subject: "user:alice", limit: 5 });
if (recalled.ok) console.log(recalled.value);
```

All storage methods return `MemoryResult<T> = { ok: true; value } | { ok: false; error }` — branch on `.ok`.

## Conversations

```ts
const conv = memory.conversation("thread-42", { tokenBudget: 8000 });
await conv.add({ role: "user", content: "Plan a trip to Tokyo" });
const snapshot = await conv.get({ tokenBudget: 4000 });
```

## Highlights

- Composite recall scoring (similarity + recency decay + confidence + tag overlap)
- Temporal queries — `memory.at(timestamp)` recalls facts as of a point in time
- Soft `forget()` and `supersede()` keep audit while excluding from recall
- AES-256-GCM encryption at rest (opt-in via `encryptionKey`)
- Token-budgeted conversation windows
- Idempotency keys for safe retries

## Documentation

Full guide: [workkit docs — Agent Memory](https://beeeku.github.io/workkit/guides/agent-memory/)
