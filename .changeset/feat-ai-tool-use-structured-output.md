---
"@workkit/ai": minor
"@workkit/ai-gateway": minor
---

Add tool use / function calling and structured output support.

**Tool use:** `aiWithTools()` for multi-turn tool calling with automatic
handler dispatch, `createToolRegistry()` for registering tools by name.
Supports single/parallel tool calls, max turns, and optional handler mode.

**Structured output:** `structuredAI()` validates LLM responses against
Standard Schema definitions with auto-retry on parse failure.
`standardSchemaToJsonSchema()` converts schemas for provider APIs.

**Gateway:** Both features normalized across Workers AI, OpenAI, and
Anthropic providers with provider-specific format conversion.
