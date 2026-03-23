---
"@workkit/testing": minor
"@workkit/hono": minor
---

Layer 3-4 enhancements

**@workkit/testing:**
- Observable mocks — all mocks now track operations automatically (reads, writes, deletes)
- Seed builders — createMockKV(initialData) and createMockD1(initialTables) for one-call fixture setup
- Error injection — failAfter(n), failOn(pattern), withLatency(min, max) for resilience testing
- Environment snapshots — snapshotEnv(env) for capturing and asserting binding state

**@workkit/hono:**
- Tiered rate limiting middleware — per-plan limits (free/pro/enterprise) with automatic 429 responses
- Quota middleware — multi-window calendar-aligned quota enforcement with per-window breakdown
- Cache jitter — optional TTL variance to prevent thundering herd on cache expiration
