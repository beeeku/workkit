# @workkit/ai-gateway

## 0.6.0

### Minor Changes

- b26dbbc: **`withRetry` now applies the retry budget per fallback tier instead of around the whole call.** Before this change, `withRetry(gateway).run(fallback(primary, secondary, …))` wrapped the entire `gateway.run` invocation — so when the primary threw a retryable error, the retry loop re-entered `gateway.run`, which re-entered the primary first. The primary's retry budget could never properly exhaust, and the contract from #81 ("primary retries per its policy first, then fallback triggers") was not honored.

  `withRetry` now detects `FallbackModelRef` model arguments and dispatches through `runWithFallback` with an inner per-tier retrying runner. Concretely:

  - Primary throws retryable errors → `withRetry` exhausts the full `maxAttempts` against the primary, then `runWithFallback` decides whether to fail over.
  - Primary throws non-retryable but fallback-matched errors → no retries on the primary, secondary runs immediately.
  - Primary recovers within its retry budget → secondary is never invoked.
  - Secondary tier gets its own independent retry budget.

  No API changes. Plain string models behave exactly as before.

  Closes #95.

### Patch Changes

- Updated dependencies [b26dbbc]
  - @workkit/errors@1.0.4

## 0.5.0

### Minor Changes

- 686926d: **Model allowlist helper.** New `@workkit/ai-gateway/allowlist` sub-export with `createModelAllowlist(config)` and `isAllowedModel(config, provider, model)` for validating untrusted model strings (e.g. a `?model=` query-param override) against a curated per-provider list. Closes #80.

  ```ts
  import { createModelAllowlist } from "@workkit/ai-gateway/allowlist";

  const allow = createModelAllowlist({
    anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
    openai: ["gpt-4o", "gpt-4o-mini"],
    groq: [{ prefix: "llama-3.1-" }], // prefix rule for families
  });

  const requested = url.searchParams.get("model") ?? DEFAULT_MODEL;
  if (!allow.isAllowed("anthropic", requested)) {
    return new Response("model not in allowlist", { status: 400 });
  }
  ```

  Matcher semantics:

  - Exact string — strict equality with the model.
  - `{ prefix }` — `model.startsWith(prefix)`.
  - Unknown provider — `false`.
  - Empty matcher array — `false`.

  Shipped as a tree-shakeable sub-export (constitution rule 4) so callers that don't need it pay zero bytes. No new runtime deps.

- 8d862f1: **Two-tier provider failover as a model reference.** New `fallback(primary, secondary, { on, onFallback? })` primitive on `@workkit/ai-gateway` lets you route a call through a secondary model when the primary throws a matching HTTP status or predicate. The returned `FallbackModelRef` plugs into `gateway.run()` exactly where a string model id would — same input, same `RunOptions`, same retry/cache/logging wrappers. Closes #81.

  ```ts
  import { createGateway, fallback } from "@workkit/ai-gateway";

  const gateway = createGateway({
    providers: {
      /* … */
    },
    defaultProvider: "anthropic",
  });

  const model = fallback("claude-sonnet-4-6", "gpt-4o", {
    on: [401, 429, 500, 502, 503, 504],
    onFallback: (err, attempt) =>
      log.warn("provider failover", { err, attempt }),
  });

  const result = await gateway.run(model, { prompt: "…" });
  result.via; // "primary" | "secondary"
  ```

  Semantics:

  - Numeric `on` entries match `err.status`, `err.statusCode`, or `err.context?.status`, walking the `.cause` chain so wrapped provider errors still trigger. Exact number match.
  - Function `on` entries receive the raw error and return `true` to fall over.
  - `onFallback` fires once when the primary fails and the secondary is about to run, with the attempt tier (`"primary"`) that triggered the transition.
  - When both tiers fail, `run()` throws `FallbackExhaustedError` with `.primaryError` and `.secondaryError` preserved for inspection.
  - `AiOutput.via` is tagged `"primary" | "secondary"` so observability pipelines can break down traffic by tier. Absent on direct string-model calls.

  Wrapper interop: `withCache`, `withLogging`, and `withRetry` accept a `FallbackModelRef` where they previously accepted a model string, and use a stable `modelLabel(ref)` → `"fallback:primary→secondary"` for cache keys and log labels (no more `[object Object]` stringification). **Retry currently wraps the whole fallback call, not each tier independently** — if the primary throws a retryable error, `withRetry` retries the overall `gateway.run(ref, …)`, which re-enters the primary first. Per-tier retry (primary exhausts its retry budget before the secondary is tried) is a follow-up; until then, put `withRetry` _inside_ each tier explicitly if that matters for your use case.

  Two-tier only for now — `fallback()` accepts string model ids, not nested refs, so n-ary chains aren't supported by this API yet. Circuit-breaker ("stop trying primary for N minutes") is a separate follow-up. No new runtime deps.

- 57bc09b: feat(ai-gateway/structured): `structuredWithRetry` — reprompt on schema parse failure (#83)

  Adds a caller-controlled reprompt loop for LLM callers that parse structured output against a Standard Schema. On validation failure the previous attempt's error message is threaded into the next `generate` call so callers decide how to fold the reminder into the prompt (system vs user, wording). Exhausts after `maxAttempts` with a `StructuredRetryExhaustedError` that carries `attempts`, `lastError`, and `lastRaw`. Non-validation errors (network, abort) propagate immediately — per-attempt network retry stays on the gateway (`withRetry`).

  Scope-corrected from `@workkit/workflow` to `@workkit/ai-gateway/structured` per the issue body: the workflow package's step retry is generic and doesn't know about schemas or LLM reprompts; this loop belongs next to the existing `structuredAI` helper.

  New public surface (same `src/index.ts` entry):

  - `structuredWithRetry<T>(opts)` → `{ value, attempts, raw }`
  - `StructuredWithRetryOptions<T>`, `StructuredWithRetryResult<T>`
  - `StructuredRetryExhaustedError`

### Patch Changes

- 776a6bc: **Fix: Workers AI Llama models actually execute tool calls.** Closes #94.

  The `workers-ai` provider already injected `tools` into the payload, but `extractWorkersAiToolCalls` only understood the OpenAI-compat shape (`{id, type: "function", function: {name, arguments: string}}`). `@cf/meta/llama-*` returns tool calls in a **flat shape** (`{name, arguments: object}` — no `function` wrapper, no `id`), which the parser silently dropped. Net effect: callers wiring tools on Llama models saw `toolCalls: []` and a polite "I'm not able to call any tools" text reply.

  This patch normalizes Llama's flat shape into the OpenAI-compat envelope before parsing, so both shapes flow through the same `parseRawToolCalls` path and consumers get populated `AiOutput.toolCalls` regardless of which provider responded.

  Also fixes the streaming counterpart: `streamWorkersAi` was ignoring `options` entirely, so tool schemas were never injected on streams and any streamed `tool_calls` were dropped. It now threads `toolOptions` through and emits `tool_use` events for each Llama tool call (deduped by id in case the provider re-emits across SSE frames).

  **Behavior change note:** calls that previously silently no-opped on `tools` against a Llama model will now actually invoke tools. Low risk — this is the documented, typed behavior.

  Pairs well with `@workkit/agent`'s `strictTools: true` (shipped in a prior release) — Llama hallucinates tool names more than Claude does, and strict mode turns a potential runaway step-budget into a fail-fast `OffPaletteToolError`.

## 0.4.0

### Minor Changes

- 3535cb1: **Embeddings support.** New optional `gateway.embed(model, input, options?)` method returning a unified `EmbedOutput { vectors, raw, usage?, provider, model }`. Closes #69.

  ```ts
  // Workers AI
  const { vectors } = await gateway.embed!("@cf/baai/bge-base-en-v1.5", {
    text: ["chunk 1", "chunk 2"],
  });

  // OpenAI (with or without CF AI Gateway routing)
  const { vectors, usage } = await gateway.embed!("text-embedding-3-small", {
    text: "hello",
  });
  ```

  Provider coverage:

  - **Workers AI** — `binding.run(model, { text })`.
  - **OpenAI** — `POST /embeddings`, routes through `cfGateway` when configured, preserves vector order via `index` field.
  - **Anthropic** — throws `ValidationError` (no public embeddings endpoint).
  - **Custom** — delegates to user-supplied `embed?(model, input)` on the provider config; throws `ValidationError` if not implemented.

  Single-string input is normalized to a one-element array so callers can use either shape.

  **Wrapper integration:**

  - `withCache` — caches embeddings under a dedicated `ai-embed-cache:` key namespace so embedding and completion responses never collide. Keyed on `(model, input)`.
  - `withRetry` — retries retryable embed errors using the same error-driven strategy as `run`/`stream`.
  - `withLogging` — currently wires `onError` only for embeds; `onRequest` / `onResponse` are typed for `AiInput`/`AiOutput` and would need embed-specific callbacks to safely log embedding traffic (follow-up).

  Additive — no breaking changes. Unblocks future `@workkit/memory` consolidation onto the gateway.

- 62d460d: **Port `@workkit/ai` helpers into `@workkit/ai-gateway`** — phase 2 of [ADR-001](../.maina/decisions/001-ai-package-consolidation.md). All additive; no breaking changes.

  New public exports:

  - **`createToolRegistry()`** + `ToolHandler` / `ToolRegistry` types — `Map<name, handler>` helper for dispatching tool calls. Drop-in replacement for the same-named helper in `@workkit/ai`, but typed against `GatewayToolDefinition` / `GatewayToolCall`.
  - **`aiWithTools(gateway, model, input, options)`** — multi-turn tool-use session. When `options.handler` is supplied, the model's tool calls are auto-dispatched and results fed back for another turn (up to `maxTurns`). When absent, the first set of tool calls is returned for manual dispatch. Operates on `gateway.run()` with normalized tool-call handling across Workers AI / OpenAI / Anthropic.
  - **`structuredAI(gateway, model, input, { schema })`** + `StructuredOutputError` — JSON-mode output with Standard Schema validation and self-correcting retry. Calls `gateway.run(…, { responseFormat: { jsonSchema } })`; only OpenAI enforces the schema natively (via `response_format: { type: "json_schema" }`). Workers AI and Anthropic use instruction-based JSON mode — the schema is included in a system prompt, and `structuredAI` validates the response client-side and retries with the validation errors fed back to the model.
  - **`standardSchemaToJsonSchema(schema)`** — Zod / Valibot / ArkType → JSON Schema converter (prefers the schema's own `toJSONSchema()`, falls back to Zod internals, `{type:"object"}` as a permissive default).
  - **`estimateTokens(text | messages)`** — rough heuristic for capacity/cost planning.

  Example:

  ```ts
  import {
    createGateway,
    aiWithTools,
    createToolRegistry,
  } from "@workkit/ai-gateway";

  const gateway = createGateway({
    providers: { anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY } },
    defaultProvider: "anthropic",
  });

  const registry = createToolRegistry();
  registry.register("get_weather", {
    definition: {
      name: "get_weather",
      description: "…",
      parameters: {
        /* … */
      },
    },
    handler: async (args) =>
      JSON.stringify(await getWeather(args.location as string)),
  });

  const result = await aiWithTools(
    gateway,
    "claude-sonnet-4-6",
    { messages: [{ role: "user", content: "weather in SF?" }] },
    { tools: registry.getTools(), handler: (call) => registry.execute(call) }
  );
  ```

  This unblocks the full `@workkit/ai@1.0` shim rewrite tracked in #63: once this ships, `@workkit/ai` can become thin re-exports over `@workkit/ai-gateway`.

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
