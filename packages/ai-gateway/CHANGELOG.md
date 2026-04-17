# @workkit/ai-gateway

## 0.2.1

### Patch Changes

- 9a52478: - `CacheStorage` interface now includes a `delete` method (required for correct
  cache invalidation).
  - `withCache().invalidate()` now calls `storage.delete()` instead of writing
    an empty string with a 1-second TTL, which could leave stale data visible
    for up to a second.

## 0.2.0

### Minor Changes

- Add tool use / function calling and structured output support.

  **Tool use:** `aiWithTools()` for multi-turn tool calling with automatic
  handler dispatch, `createToolRegistry()` for registering tools by name.
  Supports single/parallel tool calls, max turns, and optional handler mode.

  **Structured output:** `structuredAI()` validates LLM responses against
  Standard Schema definitions with auto-retry on parse failure.
  `standardSchemaToJsonSchema()` converts schemas for provider APIs.

  **Gateway:** Both features normalized across Workers AI, OpenAI, and
  Anthropic providers with provider-specific format conversion.

## 0.1.1

### Patch Changes

- Fix workspace:_ dependencies leaking into published packages. Added resolve script to replace workspace:_ with actual semver versions before npm publish.
- Updated dependencies
  - @workkit/types@1.0.1
  - @workkit/errors@1.0.1

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

### Patch Changes

- Updated dependencies
  - @workkit/types@1.0.0
  - @workkit/errors@1.0.0
