---
"@workkit/ai": patch
"@workkit/agent": patch
---

**Follow-up fixes from Copilot review on PRs #70–#72.**

`@workkit/agent`:
- Streaming step now always returns a defined `AiOutput.raw` (falls back to `{}` if the provider's terminal `done` event doesn't include `raw`), satisfying the `Gateway` output contract.
- New regression test: consumer aborts mid-stream → the model stream surfaces the abort.
- Doc comment on `mockStreamingGateway` corrected to cover both `run()` and `stream()` paths.

`@workkit/ai`:
- `calculateDelay` and `defaultIsRetryable` now also carry `@deprecated` JSDoc (they're internal helpers for the deprecated `withRetry`). The claim in the earlier changeset that "every public export now carries `@deprecated`" is now accurate.
- `createToolRegistry` guidance corrected: `@workkit/ai-gateway` does not re-export this helper. Migrating callers can keep using it from `@workkit/ai` until the v2.0 removal or inline the equivalent `Map<string, handler>`.
- README migration table: `await` added to the "before" column examples (they were all async), and the `fallback` → `runFallback` row now notes the `cfGateway` prerequisite and the Workers-AI-only fallback path.
