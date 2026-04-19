---
"@workkit/ai-gateway": minor
---

**Model allowlist helper.** New `@workkit/ai-gateway/allowlist` sub-export with `createModelAllowlist(config)` and `isAllowedModel(config, provider, model)` for validating untrusted model strings (e.g. a `?model=` query-param override) against a curated per-provider list. Closes #80.

```ts
import { createModelAllowlist } from "@workkit/ai-gateway/allowlist";

const allow = createModelAllowlist({
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
  openai:    ["gpt-4o", "gpt-4o-mini"],
  groq:      [{ prefix: "llama-3.1-" }], // prefix rule for families
});

const requested = url.searchParams.get("model") ?? DEFAULT_MODEL;
if (!allow.isAllowed("anthropic", requested)) {
  return new Response("model not in allowlist", { status: 400 });
}
```

Matcher semantics:
- Exact string — strict equality with the model.
- `{ prefix }` — `model.startsWith(prefix)`.
- Unknown provider — `false`.
- Empty matcher array — `false`.

Shipped as a tree-shakeable sub-export (constitution rule 4) so callers that don't need it pay zero bytes. No new runtime deps.
