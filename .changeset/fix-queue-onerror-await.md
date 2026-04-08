---
"@workkit/queue": patch
---

Fix `onError` callback not being awaited in `createConsumer`.  If `onError`
returned a `Promise`, errors thrown inside it were silently swallowed and
execution could proceed in an unexpected order.
