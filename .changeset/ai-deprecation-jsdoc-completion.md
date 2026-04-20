---
"@workkit/ai": patch
---

**Complete `@deprecated` JSDoc coverage across `@workkit/ai` exports per ADR-001.** The runtime exports (`ai`, `streamAI`, `fallback`, `withRetry`, `structuredAI`, `aiWithTools`, `createToolRegistry`) already carried `@deprecated` annotations from the ADR-001 acceptance work. This adds the missing markers on the type / utility re-exports (`StructuredOutputError`, `estimateTokens`, `standardSchemaToJsonSchema`, the tools type bag, the model/IO types) so editor surfaces (LSP hover, eslint-deprecation rules) flag every public symbol consistently.

No runtime change. No API change. Tests still pass identically.

**Tracked separately:** the actual wrapper reimplementation (`ai()` constructing an internal `createGateway`, `streamAI` mapping `GatewayStreamEvent` back to `ReadableStream<Uint8Array>`, etc.) is the bigger half of #63 and is staying as its own follow-up — splitting it from the JSDoc pass keeps this PR small enough to land risk-free while still moving the deprecation timeline forward.

Refs #63.
