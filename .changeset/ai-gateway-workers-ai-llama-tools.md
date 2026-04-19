---
"@workkit/ai-gateway": patch
---

**Fix: Workers AI Llama models actually execute tool calls.** Closes #94.

The `workers-ai` provider already injected `tools` into the payload, but `extractWorkersAiToolCalls` only understood the OpenAI-compat shape (`{id, type: "function", function: {name, arguments: string}}`). `@cf/meta/llama-*` returns tool calls in a **flat shape** (`{name, arguments: object}` — no `function` wrapper, no `id`), which the parser silently dropped. Net effect: callers wiring tools on Llama models saw `toolCalls: []` and a polite "I'm not able to call any tools" text reply.

This patch normalizes Llama's flat shape into the OpenAI-compat envelope before parsing, so both shapes flow through the same `parseRawToolCalls` path and consumers get populated `AiOutput.toolCalls` regardless of which provider responded.

Also fixes the streaming counterpart: `streamWorkersAi` was ignoring `options` entirely, so tool schemas were never injected on streams and any streamed `tool_calls` were dropped. It now threads `toolOptions` through and emits `tool_use` events for each Llama tool call (deduped by id in case the provider re-emits across SSE frames).

**Behavior change note:** calls that previously silently no-opped on `tools` against a Llama model will now actually invoke tools. Low risk — this is the documented, typed behavior.

Pairs well with `@workkit/agent`'s `strictTools: true` (shipped in a prior release) — Llama hallucinates tool names more than Claude does, and strict mode turns a potential runaway step-budget into a fail-fast `OffPaletteToolError`.
