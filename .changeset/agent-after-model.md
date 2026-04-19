---
"@workkit/agent": minor
---

**Add `afterModel` hook for output-side guardrails with retry-and-reminder.** New optional `AgentHooks.afterModel(assistant, ctx)` fires after every assistant turn (text-only, tool-call, or mixed), receives the full assistant message, and may return `{ retry: true, reminder?: string }` to reject the turn and re-run the model. Tools from a rejected turn are **not** executed — the hook call site is between `step-complete` and the strict-tools pre-scan / tool dispatch, so any `tool_calls` on a rejected turn are discarded along with the assistant message.

Retries consume from `stopWhen.maxSteps` (keeps budgets honest) and are additionally capped per-step by a new `maxAfterModelRetries` option (default `2`). When the per-step cap is hit the loop soft-fails: it proceeds with the last-returned assistant message rather than throwing. Throws from `afterModel` route through `onError({ kind: "hook", error })`; if `onError` returns `{ abort: false }` the throw is suppressed and the turn is treated as no-retry, otherwise the loop terminates with `stopReason: "error"`.

New event variant `{ type: "after-model-retry", step, attempt, reminder? }` is emitted per retry so consumers can trace guardrail activity. The reminder (when present) is appended as a `{ role: "user", content: reminder }` message before the next model call; the rejected assistant message is popped from history so the model doesn't re-read its own bad output.

New export: `AfterModelDecision` type. Purely additive — existing agents ignoring the hook see zero behavior change.

Closes #58.
