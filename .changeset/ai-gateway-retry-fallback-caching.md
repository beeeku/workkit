---
"@workkit/ai-gateway": minor
---

**Three additive features for `@workkit/ai-gateway`.**

**1. `withRetry(gateway, config)`** — new wrapper that retries retryable errors (`ServiceUnavailableError`, `TimeoutError`, `RateLimitError`) using each error's own `retryStrategy` from `@workkit/errors`. Per-call `AbortSignal` aborts the retry loop immediately.

```ts
const resilient = withRetry(gateway, { maxAttempts: 3 });
await resilient.run("claude-sonnet-4-6", { prompt: "…" });
```

**2. `gateway.runFallback(entries, input, options?)`** — new *optional* method on `Gateway` that POSTs a provider-chain to the Cloudflare AI Gateway [Universal Endpoint](https://developers.cloudflare.com/ai-gateway/configuration/universal-endpoint/). CF tries each entry server-side in order and returns the first success. Requires `cfGateway` configured; supports `openai` and `anthropic` provider entries (workers-ai / custom rejected with `ValidationError`). The returned `AiOutput` identifies which provider actually served by looking up the entry's provider *type* in the config — so custom provider key names (e.g. `"claude"`, `"gpt"`) work correctly. Honors `options.timeout` via `AbortSignal`. The method is declared optional on `Gateway` so existing third-party `Gateway` implementers are not forced to add it; `createGateway`, `withRetry`, `withLogging`, and `withCache` all expose it when the underlying gateway does.

```ts
await gw.runFallback(
  [
    { provider: "anthropic", model: "claude-sonnet-4-6" },
    { provider: "openai",    model: "gpt-4o" },
  ],
  { messages: [{ role: "user", content: "hi" }] },
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
