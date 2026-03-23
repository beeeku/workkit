---
"@workkit/crypto": minor
"@workkit/cron": minor
"@workkit/ratelimit": minor
"@workkit/queue": minor
"@workkit/do": minor
---

Layer 2 enhancements: 14 new features across 5 packages

**@workkit/crypto:**
- Digital signatures with Ed25519/ECDSA (sign/verify, key pair management)
- Envelope key rotation (O(1) master key rotation without re-encrypting data)
- Authenticated metadata encryption (AAD — verified but unencrypted context)

**@workkit/cron:**
- Jitter middleware for thundering herd prevention
- Fluent cron builder API (`cron().every(5).minutes().build()`)
- Task dependencies with topological sort and cycle detection

**@workkit/ratelimit:**
- Tiered rate limiting with per-plan limits (free/pro/enterprise)
- Quota buckets with calendar-aligned windows and usage tracking

**@workkit/queue:**
- Circuit breaker for consumer fault tolerance (closed/open/half-open states)
- Workflow primitives with linear step chains, context accumulation, and rollback
- DLQ analyzer for failure pattern aggregation and insights

**@workkit/do:**
- Versioned storage with forward-only migrations in transactions
- Event sourcing with immutable event log, reducers, and periodic snapshots
- Time-bucketed aggregations for metrics with rollup and retention pruning
