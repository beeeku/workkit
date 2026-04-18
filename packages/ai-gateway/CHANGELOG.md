# @workkit/ai-gateway

## 0.3.0

### Minor Changes

- caec293: **Route Anthropic and OpenAI through Cloudflare AI Gateway.** `createGateway` accepts a new top-level `cfGateway` option that rewrites the effective base URL for HTTP providers to `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/{provider}` and injects `cf-aig-*` request headers.

  ```ts
  createGateway({
    providers: {
      anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
      openai: { type: "openai", apiKey: env.OPENAI_KEY },
    },
    cfGateway: {
      accountId: env.CF_ACCOUNT_ID,
      gatewayId: "my-gateway",
      authToken: env.CF_AIG_TOKEN, // → cf-aig-authorization
      cacheTtl: 3600, // → cf-aig-cache-ttl
      skipCache: true, // → cf-aig-skip-cache (emitted only when true)
    },
    defaultProvider: "anthropic",
  });
  ```

  Explicit `baseUrl` on a provider config still wins. Workers AI and custom providers are unaffected. Additive — no breaking changes.

- caec293: **Three additive features for `@workkit/ai-gateway`.**

  **1. `withRetry(gateway, config)`** — new wrapper that retries retryable errors (`ServiceUnavailableError`, `TimeoutError`, `RateLimitError`) using each error's own `retryStrategy` from `@workkit/errors`. Per-call `AbortSignal` aborts the retry loop immediately.

  ```ts
  const resilient = withRetry(gateway, { maxAttempts: 3 });
  await resilient.run("claude-sonnet-4-6", { prompt: "…" });
  ```

  **2. `gateway.runFallback(entries, input, options?)`** — new _optional_ method on `Gateway` that POSTs a provider-chain to the Cloudflare AI Gateway [Universal Endpoint](https://developers.cloudflare.com/ai-gateway/configuration/universal-endpoint/). CF tries each entry server-side in order and returns the first success. Requires `cfGateway` configured; supports `openai` and `anthropic` provider entries (workers-ai / custom rejected with `ValidationError`). The returned `AiOutput` identifies which provider actually served by looking up the entry's provider _type_ in the config — so custom provider key names (e.g. `"claude"`, `"gpt"`) work correctly. Honors `options.timeout` via `AbortSignal`. The method is declared optional on `Gateway` so existing third-party `Gateway` implementers are not forced to add it; `createGateway`, `withRetry`, `withLogging`, and `withCache` all expose it when the underlying gateway does.

  ```ts
  await gw.runFallback(
    [
      { provider: "anthropic", model: "claude-sonnet-4-6" },
      { provider: "openai", model: "gpt-4o" },
    ],
    { messages: [{ role: "user", content: "hi" }] }
  );
  ```

  **3. Anthropic prompt caching** — `ChatMessage` gains an optional `cacheControl?: "ephemeral"` flag. When set on a message sent to the Anthropic provider, the body builder emits a content block with `cache_control: { type: "ephemeral" }`. Also supported on system messages (emitted as the Anthropic system content-block array form). OpenAI and Workers AI silently ignore the flag, and `buildOpenAiBody` now strips it before sending.

  ```ts
  await gw.run("claude-sonnet-4-6", {
    messages: [
      { role: "system", content: longContext, cacheControl: "ephemeral" },
      { role: "user", content: "answer this" },
    ],
  });
  ```

  All three are additive; no breaking changes.

- caec293: **Streaming `tool_use` events.** `gateway.stream()` now emits `{ type: "tool_use", id, name, input }` events when the model calls a tool mid-stream. Wired for Anthropic and OpenAI. Closes #61.

  - **Anthropic**: accumulates `input_json_delta` chunks per `content_block` index, emits a single `tool_use` event on each `content_block_stop` for a tool-use block.
  - **OpenAI**: accumulates `choices[].delta.tool_calls[].function.arguments` across deltas per call index, emits `tool_use` events on `finish_reason: "tool_calls"` (or at `[DONE]` for streams that omit `finish_reason`).
  - **Malformed JSON**: if the accumulated `arguments` / `partial_json` doesn't parse, `tool_use` is still emitted with `input: {}` rather than failing the stream.
  - Workers AI tool-call streaming is not wired in this pass (format is provider-specific; follow-up if needed).

  No breaking changes — the `tool_use` event variant was already part of the `GatewayStreamEvent` union in v0.3.0.

- caec293: **Streaming via `gateway.stream()`.** New optional method on `Gateway` that returns a `ReadableStream<GatewayStreamEvent>` — a typed, provider-agnostic event stream:

  ```ts
  type GatewayStreamEvent =
    | { type: "text"; delta: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
    | { type: "done"; usage?: TokenUsage; raw?: unknown };
  ```

  Every stream ends with exactly one `done` event. Consumers that only want text use `for await (const e of stream) if (e.type === "text") { … }`.

  Supported providers in this release:

  - **Workers AI** — binding stream (`{"response": "…"}` SSE) → text + done.
  - **Anthropic** — native SSE (`content_block_delta` → text; `message_delta` usage captured into the final `done`).
  - **OpenAI** — native SSE (`choices[].delta.content` → text; final `usage` captured into `done`).
  - Routed through CF AI Gateway when `cfGateway` is configured, same as `run()`.

  `withCache`, `withLogging`, and `withRetry` each conditionally expose `stream` when the underlying gateway does. `withRetry` retries the initial connect only — mid-stream errors propagate as-is to avoid re-emitting already-delivered tokens.

  The `tool_use` event variant is defined in this changeset; its provider-specific emission (Anthropic `input_json_delta` accumulation and OpenAI `tool_calls` delta accumulation) ships alongside in `ai-gateway-stream-tool-use.md`. Additive; no breaking changes.

### Patch Changes

- caec293: **Refactor + streaming hardening.** Internal-only split of `gateway.ts` (was 804 LOC) into per-provider files under `src/providers/`; extracted CF Universal Endpoint helpers into `src/fallback.ts`. Existing `run(...)` behavior is unchanged; the new public APIs (`cfGateway`, `withRetry`, `runFallback`, `stream`, prompt caching) are covered by the minor changesets in this release.

  Streaming improvements:

  - SSE parser now accepts `\r\n\r\n` record separators in addition to `\n\n`.
  - Consumer-canceled streams now abort the underlying fetch via a per-request `AbortController`, linked to `options.signal`.
  - Stream body builders reuse `buildAnthropicBody` / `buildOpenAiBody` from the non-streaming path (no more duplicate message shaping).

- caec293: **Streaming polish.**

  - `linkedAbort` now returns a `dispose()` that `transformSse` calls on both normal completion and error paths, removing the abort listener from the external `AbortSignal`. Prevents a listener leak on long-lived signals that never abort.
  - `transformSse` explicitly `reader.cancel()`s on the error path instead of relying on GC to release the source-stream lock.
  - JSDoc on `Gateway.stream` notes the `responseFormat` caveat: the output is still a token stream — consumers must buffer and parse JSON themselves; no streamed JSON validation is performed.

  No API changes.

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
