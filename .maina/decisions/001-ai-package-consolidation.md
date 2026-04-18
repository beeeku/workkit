# ADR-001: Consolidate `@workkit/ai` into `@workkit/ai-gateway`

**Status:** Accepted
**Date:** 2026-04-18
**Supersedes:** —
**Tracks:** [#62](https://github.com/beeeku/workkit/issues/62)

## Context

Two packages in this monorepo currently handle LLM calls:

| Package | Scope | Shape | Features |
|---|---|---|---|
| `@workkit/ai` (v0.x) | Cloudflare Workers AI binding only | `ai(env.AI).run(model, input)` | retry, stream, structured output, tool use, fallback |
| `@workkit/ai-gateway` (v0.2.x) | Multi-provider (workers-ai, openai, anthropic, custom) | `createGateway({providers, defaultProvider}).run(model, input)` | retry, stream, structured output, tool use, fallback, caching, cost tracking, logging, routing, CF AI Gateway routing, prompt caching |

These packages overlap substantially. A user who wants to call Workers AI has to pick between them, and a user who starts with `@workkit/ai` then wants to add OpenAI has to migrate to `@workkit/ai-gateway`. The two packages also duplicate retry logic, streaming infrastructure, tool-use scaffolding, and structured-output helpers — effectively two implementations of the same primitives.

Recent AI-Gateway work (commits `d184fab`, `9f1de77`, `f6b92c8` — Apr 2026) added unified streaming, CF Gateway routing, provider fallback, and prompt caching, closing most of the feature gap. The `@workkit/ai` package now offers nothing that `@workkit/ai-gateway` can't — except a thinner setup surface for the Workers-AI-only case.

## Decision drivers

1. **One way to do it.** New users should not have to pick between two LLM packages.
2. **No feature drift.** Today's duplication means fixes to retry in one package don't land in the other. We've already seen this in practice.
3. **Pre-1.0 room to move.** Both packages are pre-1.0 (`@workkit/ai-gateway@0.2.1`, `@workkit/ai@0.x`). Breaking changes with a migration guide are acceptable.
4. **Workers-AI ergonomics matter.** A Workers-only user shouldn't need to build a gateway config to call a single model.

## Options considered

### Option A — Keep both, document boundaries

- `@workkit/ai` = Workers-AI-only, thin.
- `@workkit/ai-gateway` = multi-provider.
- Docs explicitly state when to use which.

**Pros:** zero migration cost.
**Cons:** two APIs, two retry implementations, two streaming implementations; the overlap is a permanent maintenance tax; new features have to be ported to both; "one way to do it" principle violated.

### Option B — Fold `@workkit/ai` into `@workkit/ai-gateway`, deprecate `@workkit/ai`

- Move any helpers unique to `@workkit/ai` (token estimation, structured output with `StructuredOutputError`) into `@workkit/ai-gateway`.
- Publish `@workkit/ai@1.0.0` as a **thin re-export + deprecation notice**: its public API continues to work via a shim, but the package docs point users at `@workkit/ai-gateway`.
- After two minor releases of deprecation, remove `@workkit/ai` at v2.0.
- Provide a migration guide with before/after for the most common cases.

**Pros:** one package, one API; no duplication; all new features automatically available to Workers-AI users.
**Cons:** user-facing migration; small ergonomic cost for Workers-AI-only callers (one extra line of gateway config).

### Option C — Invert: `@workkit/ai-gateway` depends on `@workkit/ai` primitives

- Extract `withRetry`, `streamAI`, `structuredAI`, `aiWithTools` back to `@workkit/ai` as provider-neutral primitives.
- `@workkit/ai-gateway` consumes them and adds the multi-provider layer.
- `@workkit/ai` becomes a utility package — the name no longer fits (it's about LLM abstractions, not specifically about Workers AI).

**Pros:** shared primitives, clean layering.
**Cons:** cross-package refactor; rename likely (`@workkit/llm`?); the "thin Workers-AI wrapper" value prop disappears; two-step migration for users.

## Decision

**Accept Option B.**

1. `@workkit/ai-gateway` becomes the canonical way to call LLMs in workkit — Workers AI, OpenAI, Anthropic, or custom.
2. `@workkit/ai@1.0.0` is published as a deprecation-friendly shim: existing imports (`ai(env.AI).run(...)`, `streamAI(...)`, `withRetry(...)`, `structuredAI(...)`, `aiWithTools(...)`) continue to work, implemented as thin wrappers over `@workkit/ai-gateway`'s Workers-AI provider.
3. The package description and README are updated to direct new users at `@workkit/ai-gateway`.
4. `@workkit/ai` is removed at `v2.0.0` after at least two minor releases carrying the deprecation notice.

## Migration sketch

```ts
// Before (@workkit/ai v0.x)
import { ai, streamAI, withRetry } from "@workkit/ai";

const client = ai(env.AI);
const result = await client.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "hi" }],
});

// After (@workkit/ai-gateway)
import { createGateway, withRetry } from "@workkit/ai-gateway";

const gw = createGateway({
  providers: { ai: { type: "workers-ai", binding: env.AI } },
  defaultProvider: "ai",
});
const result = await gw.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "hi" }],
});
```

For streaming, `streamAI(env.AI, model, input)` → `gw.stream(model, input)` returning the typed event stream documented in `GatewayStreamEvent`.

Most apps will be a 3-line change plus a package swap. For the Workers-AI-only case we may also add a `workersAiGateway(binding)` convenience factory that's equivalent to the above config — trivial to add if user feedback asks for it.

## Consequences

**Positive**

- One API for all LLM calls in workkit.
- Retry/stream/fallback/caching/cost tracking automatically available to Workers-AI users.
- No more feature drift between packages.
- Prompt caching (`cacheControl: "ephemeral"`) and CF Gateway routing work with Workers AI setups without code changes.

**Negative**

- Existing `@workkit/ai` users must migrate within two minor releases (roughly 2–3 months at current cadence).
- Slightly more verbose Workers-AI-only setup (5-line config vs. 1-line `ai(binding)`).
- The `StructuredOutputError` class moves packages; callers that import it explicitly will need to update their import.

**Neutral**

- No runtime-size change for Workers-AI users who previously used `@workkit/ai` — they pick up `@workkit/ai-gateway`'s broader feature set, but tree-shaking removes unused providers.

## Implementation plan (follow-up tickets)

1. **Shim `@workkit/ai`** (minor) — reimplement the existing public API as thin wrappers over `@workkit/ai-gateway`. Add deprecation `@deprecated` JSDoc on all public exports. Update README. 1 PR.
2. **Migration guide** (docs) — side-by-side examples in `packages/ai-gateway/README.md` and in `@workkit/ai`'s deprecated README. 1 PR.
3. **Announcement** (release notes) — flagship note in the next `changeset` version bump.
4. **Removal at v2.0** — schedule at least two minor releases after (1).

## Open questions

- Should we add a `workersAiGateway(binding)` convenience factory to soften the verbosity for Workers-AI-only callers? Decide based on post-shim user feedback.
- Should `@workkit/ai`'s `estimateTokens` move to `@workkit/ai-gateway` or to a separate shared `@workkit/tokens` package? Defer to step 1 of the implementation plan.
