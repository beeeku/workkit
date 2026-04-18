# @workkit/testing

## 0.4.0

### Minor Changes

- fd832ae: **Cloudflare `send_email` is now the default email transport.** `@workkit/notify`'s email adapter is refactored to be provider-pluggable (matching the WhatsApp provider pattern), with `cloudflareEmailProvider` as the default and `resendEmailProvider` as the first-class alternative. Closes #52.

  **Breaking — `emailAdapter` options shape (pre-1.0).** The `{ apiKey, from, ... }` shape is removed. Callers must explicitly pass a provider:

  ```diff
  - emailAdapter({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } })
  + emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } }) })
  ```

  Or switch to the new zero-config default:

  ```ts
  emailAdapter({
    provider: cloudflareEmailProvider({
      binding: env.SEND_EMAIL,
      from: "noreply@x.com",
    }),
  });
  ```

  `autoOptOut` now lives on the Resend provider (where webhook events originate); the Cloudflare provider has no delivery webhooks and no `autoOptOut` — bounce synthesis from inbound DSN is tracked in the roadmap (#53 / #54).

  **`@workkit/mail` added as optional peerDependency on `@workkit/notify`.** Only users of `cloudflareEmailProvider` install it.

  **`@workkit/testing` gains `createMockSendEmail` and `createMockForwardableEmail`** — promoted from a private helper in `@workkit/mail`. Matches the `createMockKV` / `createMockD1` / `createMockR2` pattern. `@workkit/mail` tests migrated to consume these.

  **`WebhookSignatureError`** takes a `provider: "resend" | "cloudflare"` arg; error messages now indicate which provider failed verification.

  Follow-ups filed: #53 (parseBounceDSN), #54 (createBounceRoute), #55 (retry strategy in AdapterSendResult), #56 (docs positioning), #57 (SES/Postmark provider stubs).

## 0.3.0

### Minor Changes

- 7b9092f: Back `createMockD1` with a real SQLite engine (`bun:sqlite` on Bun, `node:sqlite` on Node ≥22) instead of a regex-based parser. Fixes five classes of silently-wrong results reported in #48: literal values mid-`VALUES (...)` no longer shift bound params; `SELECT COUNT(*) AS <alias>` works for any alias; `UPDATE ... RETURNING` with a subquery in `WHERE` is supported; `ON CONFLICT(...) DO UPDATE SET ... excluded.x` is honored; `INSERT OR IGNORE` actually enforces uniqueness.

  Public API of `createMockD1` is unchanged. Breaking behaviors (removed lenient shims): tables are no longer auto-created on `INSERT` — emit `CREATE TABLE` explicitly or seed via `initialTables` with non-empty rows (empty arrays in `initialTables` are ignored since no schema can be inferred); column lookups are now case-sensitive to match D1. `engines.node` raised to `>=22` (for `node:sqlite`).

## 0.2.0

### Minor Changes

- e9a8e7f: Layer 3-4 enhancements

  **@workkit/testing:**

  - Observable mocks — all mocks now track operations automatically (reads, writes, deletes)
  - Seed builders — createMockKV(initialData) and createMockD1(initialTables) for one-call fixture setup
  - Error injection — failAfter(n), failOn(pattern), withLatency(min, max) for resilience testing
  - Environment snapshots — snapshotEnv(env) for capturing and asserting binding state

  **@workkit/hono:**

  - Tiered rate limiting middleware — per-plan limits (free/pro/enterprise) with automatic 429 responses
  - Quota middleware — multi-window calendar-aligned quota enforcement with per-window breakdown
  - Cache jitter — optional TTL variance to prevent thundering herd on cache expiration

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
