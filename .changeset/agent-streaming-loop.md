---
"@workkit/agent": minor
---

**Streaming text via `agent.stream()`.** When the configured gateway exposes `gateway.stream()` (i.e. `@workkit/ai-gateway@>=0.3.0` with a streaming-capable provider), the agent loop now streams each model step and emits `text-delta` events per token as they arrive, instead of once per step with the full text. Closes #68.

```ts
const agent = defineAgent({ provider: gateway, /* … */ })

for await (const event of agent.stream({ messages })) {
  if (event.type === "text-delta") process.stdout.write(event.delta)
  if (event.type === "tool-start") console.log("tool:", event.call.name)
  if (event.type === "done") console.log("stopped:", event.stopReason)
}
```

Behavior:
- If `gateway.stream` exists, each step uses it; text deltas arrive as the model produces them.
- If `gateway.stream` is not implemented, falls back to `gateway.run` and synthesizes a single `text-delta` per step (matches pre-0.2.x behavior).
- Tool calls collected from the stream's `tool_use` events are dispatched by the loop exactly as before — hooks, handoffs, and stop reasons are unchanged.
- `options.signal` and `stopWhen` cap streaming the same way they cap non-streaming.

No breaking changes; public `AgentEvent` shape is unchanged.
