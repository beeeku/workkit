---
"@workkit/ai": patch
---

refactor(ai): delegate `createToolRegistry` to `@workkit/ai-gateway`

First slice of the `@workkit/ai` → `@workkit/ai-gateway` deprecation shim
tracked in #63 / #105 (ADR-001). Replaces the local `Map<string, ToolHandler>`
implementation in `packages/ai/src/tool-registry.ts` with a re-export of the
structurally identical `createToolRegistry` from `@workkit/ai-gateway`
(`GatewayToolDefinition` / `GatewayToolCall` have the same three-field shape
as `ToolDefinition` / `ToolCall`, so the returned object satisfies the
ai-local `ToolRegistry` interface without runtime bridging). Existing tests
in `packages/ai/tests/tool-registry.test.ts` pass unchanged, which is the
delegation-parity acceptance criterion in #105.

No user-visible behavior change: same public signature, same JSDoc, same
error message on unknown tool. Establishes the delegation pattern; the
remaining six exports (`ai`, `streamAI`, `fallback`, `withRetry`,
`structuredAI`, `aiWithTools`) will follow in subsequent slices before
`@workkit/ai` bumps to `v1.0.0` per the ticket's step 4.

dep-justification: `@workkit/ai-gateway` (60 KB unpacked) is added as a
regular `dependencies` entry, above the 50 KB rule 1 threshold. This is the
entire point of ADR-001 — replacing parallel implementations with delegation
to the gateway — so the size is the intended cost, not incidental bloat.
The gateway is a workspace sibling and every downstream consumer of
`@workkit/ai` is expected to eventually migrate to it directly.
