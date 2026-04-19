---
"@workkit/ai-gateway": minor
---

**Two-tier provider failover as a model reference.** New `fallback(primary, secondary, { on, onFallback? })` primitive on `@workkit/ai-gateway` lets you route a call through a secondary model when the primary throws a matching HTTP status or predicate. The returned `FallbackModelRef` plugs into `gateway.run()` exactly where a string model id would — same input, same `RunOptions`, same retry/cache/logging wrappers. Closes #81.

```ts
import { createGateway, fallback } from "@workkit/ai-gateway";

const model = fallback("claude-sonnet-4-6", "gpt-4o", {
  on: [401, 429, 500, 502, 503, 504],
  onFallback: (err, attempt) => log.warn("provider failover", { err, attempt }),
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
- Retry (`withRetry`) still wraps each tier independently: the primary retries per its policy first, and only once it gives up does the fallback trigger.

Two-tier only for now — chain by nesting if you need three tiers. Circuit-breaker ("stop trying primary for N minutes") is a separate follow-up. No new runtime deps.
