---
"@workkit/agent": minor
---

**Add `strictTools` mode for off-palette rejection.** New `defineAgent({ strictTools: true })` opt-in rejects tool calls naming a tool outside the agent's palette: the loop terminates with `stopReason: "error"`, emits a `{ type: "tool-rejected", call, reason: "off-palette", step }` event, throws a typed `OffPaletteToolError` (carrying `toolName` and `allowedPalette`), and does **not** execute any sibling calls from the same assistant turn.

Default remains `false` — preserves the current soft behavior where unknown tool names return a `"unknown tool: <name>"` tool-result message and the loop continues. Purely additive; zero migration cost.

Motivation: strong models self-correct after a soft unknown-tool message, but weaker open-weight models (e.g. Llama 3.x routed through CF AI Gateway) tend to double down on hallucinated tool names and burn the entire step budget. Strict mode lets consumers opt into fail-fast when they know their model is weak or need predictable budgets.

Closes #79.
