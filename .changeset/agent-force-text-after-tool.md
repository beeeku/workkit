---
"@workkit/agent": minor
---

**Add `forceTextAfterTool` agent option for post-tool `toolChoice: "none"` enforcement.** When enabled, the loop sends `toolChoice: "none"` on the assistant turn that immediately follows a tool execution — forcing a plain-text response. Works around models (notably Llama 3.x routed through Workers AI) that loop on identical tool calls instead of transitioning to text after the tool has already returned.

```ts
defineAgent({
  name: "technical",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  provider: gateway,
  tools: [getQuote, getOptionChain, computeGreeks],
  forceTextAfterTool: true, // <- post-tool turn forced to text
  stopWhen: { maxSteps: 2 },
});
```

Default: `false` — preserves existing behavior. Reset on handoff: a freshly-entered handoff target starts with `toolChoice: "auto"` regardless of the previous agent's tool calls. The flag is preserved across `afterModel` retries (the retry is still the post-tool step), so a `forceTextAfterTool` retry doesn't accidentally re-enable tool calls.

Closes #97.
