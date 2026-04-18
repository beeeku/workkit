---
"@workkit/ai-gateway": minor
---

**Port `@workkit/ai` helpers into `@workkit/ai-gateway`** — phase 2 of [ADR-001](../packages/../.maina/decisions/001-ai-package-consolidation.md). All additive; no breaking changes.

New public exports:

- **`createToolRegistry()`** + `ToolHandler` / `ToolRegistry` types — `Map<name, handler>` helper for dispatching tool calls. Drop-in replacement for the same-named helper in `@workkit/ai`, but typed against `GatewayToolDefinition` / `GatewayToolCall`.
- **`aiWithTools(gateway, model, input, options)`** — multi-turn tool-use session. When `options.handler` is supplied, the model's tool calls are auto-dispatched and results fed back for another turn (up to `maxTurns`). When absent, the first set of tool calls is returned for manual dispatch. Operates on `gateway.run()` with normalized tool-call handling across Workers AI / OpenAI / Anthropic.
- **`structuredAI(gateway, model, input, { schema })`** + `StructuredOutputError` — JSON-mode output with Standard Schema validation and self-correcting retry. Calls `gateway.run(…, { responseFormat: { jsonSchema } })` so providers with strict schema support (OpenAI, Workers AI) can enforce natively, with Anthropic falling back to instruction-based JSON mode.
- **`standardSchemaToJsonSchema(schema)`** — Zod / Valibot / ArkType → JSON Schema converter (prefers the schema's own `toJSONSchema()`, falls back to Zod internals, `{type:"object"}` as a permissive default).
- **`estimateTokens(text | messages)`** — rough heuristic for capacity/cost planning.

Example:

```ts
import { createGateway, aiWithTools, createToolRegistry } from "@workkit/ai-gateway"

const gateway = createGateway({
  providers: { anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY } },
  defaultProvider: "anthropic",
})

const registry = createToolRegistry()
registry.register("get_weather", {
  definition: { name: "get_weather", description: "…", parameters: { /* … */ } },
  handler: async (args) => JSON.stringify(await getWeather(args.location as string)),
})

const result = await aiWithTools(gateway, "claude-sonnet-4-6",
  { messages: [{ role: "user", content: "weather in SF?" }] },
  { tools: registry.getTools(), handler: (call) => registry.execute(call) },
)
```

This unblocks the full `@workkit/ai@1.0` shim rewrite tracked in #63: once this ships, `@workkit/ai` can become thin re-exports over `@workkit/ai-gateway`.
