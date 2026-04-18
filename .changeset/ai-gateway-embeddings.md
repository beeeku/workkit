---
"@workkit/ai-gateway": minor
---

**Embeddings support.** New optional `gateway.embed(model, input, options?)` method returning a unified `EmbedOutput { vectors, raw, usage?, provider, model }`. Closes #69.

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
