---
"@workkit/ai": patch
---

**Deprecation notice — `@workkit/ai` is folding into `@workkit/ai-gateway`.** Every public export now carries a `@deprecated` JSDoc tag pointing at its `@workkit/ai-gateway` equivalent, and the README leads with a migration table. Implementations are unchanged in this release — nothing breaks — but new code should start with `@workkit/ai-gateway`. See [ADR-001](../packages/../.maina/decisions/001-ai-package-consolidation.md).

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
