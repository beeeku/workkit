---
"@workkit/ai-gateway": minor
---

feat(ai-gateway/structured): `structuredWithRetry` — reprompt on schema parse failure (#83)

Adds a caller-controlled reprompt loop for LLM callers that parse structured output against a Standard Schema. On validation failure the previous attempt's error message is threaded into the next `generate` call so callers decide how to fold the reminder into the prompt (system vs user, wording). Exhausts after `maxAttempts` with a `StructuredRetryExhaustedError` that carries `attempts`, `lastError`, and `lastRaw`. Non-validation errors (network, abort) propagate immediately — per-attempt network retry stays on the gateway (`withRetry`).

Scope-corrected from `@workkit/workflow` to `@workkit/ai-gateway/structured` per the issue body: the workflow package's step retry is generic and doesn't know about schemas or LLM reprompts; this loop belongs next to the existing `structuredAI` helper.

New public surface (same `src/index.ts` entry):

- `structuredWithRetry<T>(opts)` → `{ value, attempts, raw }`
- `StructuredWithRetryOptions<T>`, `StructuredWithRetryResult<T>`
- `StructuredRetryExhaustedError`
