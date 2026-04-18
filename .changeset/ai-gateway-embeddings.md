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

Single-string input is normalized to a one-element array so callers can use either shape. `withCache`, `withLogging`, and `withRetry` each conditionally expose `embed` when the underlying gateway does. Additive — no breaking changes.

This unblocks [#63](https://github.com/beeeku/workkit/issues/63) (`@workkit/ai` deprecation shim) and future `@workkit/memory` consolidation onto the gateway.
