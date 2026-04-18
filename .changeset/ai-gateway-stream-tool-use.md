---
"@workkit/ai-gateway": minor
---

**Streaming `tool_use` events.** `gateway.stream()` now emits `{ type: "tool_use", id, name, input }` events when the model calls a tool mid-stream. Wired for Anthropic and OpenAI. Closes #61.

- **Anthropic**: accumulates `input_json_delta` chunks per `content_block` index, emits a single `tool_use` event on each `content_block_stop` for a tool-use block.
- **OpenAI**: accumulates `choices[].delta.tool_calls[].function.arguments` across deltas per call index, emits `tool_use` events on `finish_reason: "tool_calls"` (or at `[DONE]` for streams that omit `finish_reason`).
- **Malformed JSON**: if the accumulated `arguments` / `partial_json` doesn't parse, `tool_use` is still emitted with `input: {}` rather than failing the stream.
- Workers AI tool-call streaming is not wired in this pass (format is provider-specific; follow-up if needed).

No breaking changes — the `tool_use` event variant was already part of the `GatewayStreamEvent` union in v0.3.0.
