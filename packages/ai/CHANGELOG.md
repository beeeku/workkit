# @workkit/ai

## 0.2.2

### Patch Changes

- 5dee1d2: **Complete `@deprecated` JSDoc coverage across `@workkit/ai` exports per ADR-001.** The runtime exports (`ai`, `streamAI`, `fallback`, `withRetry`, `structuredAI`, `aiWithTools`, `createToolRegistry`) already carried `@deprecated` annotations from the ADR-001 acceptance work. This adds the missing markers on the type / utility re-exports (`StructuredOutputError`, `estimateTokens`, `standardSchemaToJsonSchema`, the tools type bag, the model/IO types) so editor surfaces (LSP hover, eslint-deprecation rules) flag every public symbol consistently.

  No runtime change. No API change. Tests still pass identically.

  **Tracked separately:** the actual wrapper reimplementation (`ai()` constructing an internal `createGateway`, `streamAI` mapping `GatewayStreamEvent` back to `ReadableStream<Uint8Array>`, etc.) is the bigger half of #63 and is staying as its own follow-up — splitting it from the JSDoc pass keeps this PR small enough to land risk-free while still moving the deprecation timeline forward.

  Refs #63.

- Updated dependencies [b26dbbc]
  - @workkit/errors@1.0.4

## 0.2.1

### Patch Changes

- ba6ec37: **Deprecation notice — `@workkit/ai` is folding into `@workkit/ai-gateway`.** Every public export now carries a `@deprecated` JSDoc tag pointing at its `@workkit/ai-gateway` equivalent, and the README leads with a migration table. Implementations are unchanged in this release — nothing breaks — but new code should start with `@workkit/ai-gateway`. See [ADR-001](../packages/../.maina/decisions/001-ai-package-consolidation.md).

  **Deprecated exports:**

  - `ai()` → `createGateway({ providers: { ai: { type: "workers-ai", binding } }, defaultProvider: "ai" })`
  - `streamAI()` → `gateway.stream!(model, input)` (returns typed `GatewayStreamEvent`)
  - `fallback()` → `gateway.runFallback!(entries, input)` (server-side via CF Universal Endpoint)
  - `withRetry()` → `withRetry(gateway, { maxAttempts })`
  - `structuredAI()` → `gateway.run(model, input, { responseFormat: { jsonSchema } })`
  - `aiWithTools()` → `gateway.run(model, input, { toolOptions })` + manual dispatch
  - `createToolRegistry()` → same function from `@workkit/ai-gateway`

  **Not deprecated:** `StructuredOutputError` and `estimateTokens` remain.

  **Timeline:** removal scheduled for `@workkit/ai@2.0`. The full reimplementation as a shim over `@workkit/ai-gateway` is tracked in [#63](https://github.com/beeeku/workkit/issues/63) and will ship as `@workkit/ai@1.0` before the 2.0 removal.

- dcb8d1b: **Follow-up fixes from Copilot review on PRs #70–#72.**

  `@workkit/agent`:

  - Streaming step now always returns a defined `AiOutput.raw` (falls back to `{}` if the provider's terminal `done` event doesn't include `raw`), satisfying the `Gateway` output contract.
  - New regression test: consumer aborts mid-stream → the model stream surfaces the abort.
  - Doc comment on `mockStreamingGateway` corrected to cover both `run()` and `stream()` paths.

  `@workkit/ai`:

  - `calculateDelay` and `defaultIsRetryable` now also carry `@deprecated` JSDoc (they're internal helpers for the deprecated `withRetry`). The claim in the earlier changeset that "every public export now carries `@deprecated`" is now accurate.
  - `createToolRegistry` guidance corrected: `@workkit/ai-gateway` does not re-export this helper. Migrating callers can keep using it from `@workkit/ai` until the v2.0 removal or inline the equivalent `Map<string, handler>`.
  - README migration table: `await` added to the "before" column examples (they were all async), and the `fallback` → `runFallback` row now notes the `cfGateway` prerequisite and the Workers-AI-only fallback path.

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
