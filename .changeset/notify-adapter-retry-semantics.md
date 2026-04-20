---
"@workkit/notify": minor
---

**Preserve retry semantics through adapter `send()` results.** `AdapterSendResult` now carries optional `retryable?: boolean` and `retryStrategy?: RetryStrategy` fields on failures, so the provider's classification of "this is transient, retry with backoff" vs "this is terminal, don't retry" survives the boundary into the dispatch pipeline. See [ADR-002](.maina/decisions/002-notify-adapter-retry-semantics.md).

```ts
const result = await emailAdapter.send(args);
if (result.status === "failed") {
  if (result.retryable === false) {
    // Terminal failure — don't requeue.
  } else if (result.retryStrategy?.kind === "exponential") {
    // Server / queue can apply the recommended backoff.
  }
}
```

Migrated providers in this change:

- **`cloudflareEmailProvider`** — catches `WorkkitError` from `@workkit/mail` (e.g. `DeliveryError` → retryable + exponential, `InvalidAddressError` → terminal) and propagates the metadata via the new `adapterFailedFromError` helper.
- **`resendEmailProvider`** — classifies failure modes explicitly: network errors and HTTP `5xx`/`429` are retryable (exponential), other `4xx` are terminal, missing-id responses are terminal.

`adapterFailedFromError(err)` is exported from `@workkit/notify` so custom-adapter authors can opt in with one call inside their `catch` blocks instead of inlining the `instanceof WorkkitError` check.

**Out of scope (separate follow-ups):**

- `createNotifyConsumer` does not yet act on the new fields when deciding ack vs retry — that requires touching `@workkit/queue`'s ack/retry contract and is filed separately. Until then, the metadata flows through the result type but isn't yet consumed by the dispatcher.
- In-app and WhatsApp adapters still return the legacy flat shape. Migrating them is mechanical follow-up work; the new fields are optional so this isn't a breaking gap.
- Persisting the retry hints in `notification_deliveries` is a schema migration and tracked separately.

Closes #55.
