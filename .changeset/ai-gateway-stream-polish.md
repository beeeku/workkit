---
"@workkit/ai-gateway": patch
---

**Streaming polish.**

- `linkedAbort` now returns a `dispose()` that `transformSse` calls on both normal completion and error paths, removing the abort listener from the external `AbortSignal`. Prevents a listener leak on long-lived signals that never abort.
- `transformSse` explicitly `reader.cancel()`s on the error path instead of relying on GC to release the source-stream lock.
- JSDoc on `Gateway.stream` notes the `responseFormat` caveat: the output is still a token stream — consumers must buffer and parse JSON themselves; no streamed JSON validation is performed.

No API changes.
