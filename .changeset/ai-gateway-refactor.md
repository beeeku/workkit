---
"@workkit/ai-gateway": patch
---

**Refactor + streaming hardening.** Internal-only split of `gateway.ts` (was 804 LOC) into per-provider files under `src/providers/`; extracted CF Universal Endpoint helpers into `src/fallback.ts`. Existing `run(...)` behavior is unchanged; the new public APIs (`cfGateway`, `withRetry`, `runFallback`, `stream`, prompt caching) are covered by the minor changesets in this release.

Streaming improvements:
- SSE parser now accepts `\r\n\r\n` record separators in addition to `\n\n`.
- Consumer-canceled streams now abort the underlying fetch via a per-request `AbortController`, linked to `options.signal`.
- Stream body builders reuse `buildAnthropicBody` / `buildOpenAiBody` from the non-streaming path (no more duplicate message shaping).
