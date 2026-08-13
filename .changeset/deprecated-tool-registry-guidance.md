---
"@workkit/ai": patch
---

fix(ai): correct `@deprecated` guidance on `createToolRegistry`

The previous JSDoc claimed `@workkit/ai-gateway` did not re-export
`createToolRegistry` and told adopters to inline their own `Map` wrapper.
The gateway does export it (`packages/ai-gateway/src/index.ts`), and the
implementation is structurally identical. Updated guidance points at the
re-export and calls out the only migration step: rename `ToolDefinition`
→ `GatewayToolDefinition` and `ToolCall` → `GatewayToolCall`, matching the
notice already on `packages/ai/src/tools.ts`. Doc-only change; no runtime
behavior touched.
