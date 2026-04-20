---
"@workkit/ai-gateway": minor
---

**`withRetry` now applies the retry budget per fallback tier instead of around the whole call.** Before this change, `withRetry(gateway).run(fallback(primary, secondary, …))` wrapped the entire `gateway.run` invocation — so when the primary threw a retryable error, the retry loop re-entered `gateway.run`, which re-entered the primary first. The primary's retry budget could never properly exhaust, and the contract from #81 ("primary retries per its policy first, then fallback triggers") was not honored.

`withRetry` now detects `FallbackModelRef` model arguments and dispatches through `runWithFallback` with an inner per-tier retrying runner. Concretely:

- Primary throws retryable errors → `withRetry` exhausts the full `maxAttempts` against the primary, then `runWithFallback` decides whether to fail over.
- Primary throws non-retryable but fallback-matched errors → no retries on the primary, secondary runs immediately.
- Primary recovers within its retry budget → secondary is never invoked.
- Secondary tier gets its own independent retry budget.

No API changes. Plain string models behave exactly as before.

Closes #95.
