# @workkit/crypto

## 0.2.0

### Minor Changes

- 630a46a: Layer 2 enhancements: 14 new features across 5 packages

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

## 0.1.1

### Patch Changes

- Fix workspace:_ dependencies leaking into published packages. Added resolve script to replace workspace:_ with actual semver versions before npm publish.

## 0.1.0

### Minor Changes

- First stable release of the workkit Cloudflare Workers utility suite.

  ### Highlights

  - **18 packages** covering the full Cloudflare Workers API surface: KV, D1, R2, Queues, Durable Objects, Cron, Cache, Rate Limiting, Crypto, AI, AI Gateway, API routing, Auth, and Environment validation
  - **3 framework integrations**: Hono, Astro, and Remix middleware with typed env and error handling
  - **CLI** (`npx workkit`): scaffolding, validation, migrations, seeding, client generation, and docs generation
  - **Testing utilities** (`@workkit/testing`): in-memory mocks for all Cloudflare bindings
  - **Zero runtime dependencies** — each package is self-contained with full TypeScript types
  - **Standard Schema support** — works with Zod, Valibot, or any Standard Schema compliant validator

  ### Fixes since 0.0.1

  - CLI now bundles internal dependencies (fixes `npx workkit` failing with protocol error)
  - All lint and a11y issues resolved
  - Full test coverage: 2,456+ unit tests, 245 e2e tests
  - Clean typecheck across all packages
