# ADR-002: Preserve retry semantics through `@workkit/notify` adapter results

**Status:** Accepted
**Date:** 2026-04-20
**Supersedes:** —
**Tracks:** [#55](https://github.com/beeeku/workkit/issues/55)

## Context

`AdapterSendResult` (the value every notify adapter — email, in-app, WhatsApp — returns from `send()`) is currently flat:

```ts
export interface AdapterSendResult {
  providerId?: string;
  status: Exclude<DeliveryStatus, "queued" | "duplicate" | "skipped">;
  error?: string;
}
```

When a provider's underlying call fails, the adapter typically catches a `WorkkitError` from `@workkit/mail`, `@workkit/errors`, or its own SDK and converts it to this shape:

```ts
} catch (err) {
  return { status: "failed", error: err instanceof Error ? err.message : String(err) };
}
```

That conversion **loses the two pieces of metadata `WorkkitError` already carries**:

- `retryable: boolean` — whether the operation should be retried at all.
- `defaultRetryStrategy: RetryStrategy` — the recommended backoff (`{ kind: "exponential", baseMs, maxMs, maxAttempts }`, etc.).

The pipeline downstream of the adapter (`createNotifyConsumer` → delivery records → queue retry) therefore can't distinguish between "this email failed because the upstream returned 503, please retry with exponential backoff" and "this email failed because the From address is malformed, never retry." The only retry policy in play today is whatever the queue consumer applies uniformly to every failure — which is correct for transient failures and wrong for terminal ones.

## Decision drivers

1. **Errors already know.** `WorkkitError.retryable` and `WorkkitError.defaultRetryStrategy` are the source of truth. The adapter shouldn't have to second-guess them.
2. **Additive, not breaking.** Custom adapter authors should not be forced to migrate. Existing flat `{ status, error }` results must keep working.
3. **No cross-package gymnastics.** `@workkit/notify` should not start importing `WorkkitError` *types* in its public signature — that couples every adapter to the error class hierarchy. We surface the *primitive* shapes (`boolean` + `RetryStrategy`) instead.
4. **Defer queue-policy changes.** The question of whether `createNotifyConsumer` should consult the new fields and call `ack` vs `retry` is a separate decision (touches `@workkit/queue` retry semantics). This ADR scopes only the *transport* of the metadata.

## Options considered

### Option A — Extend `AdapterSendResult` with primitive retry hints

```ts
interface AdapterSendFailedResult {
  providerId?: string;
  status: "failed";
  error: string;
  retryable?: boolean;
  retryStrategy?: RetryStrategy;
}
```

- ✅ Additive. Existing adapters keep returning `{ status: "failed", error }` and the new fields default to `undefined`.
- ✅ No new public type imports — `RetryStrategy` already lives in `@workkit/errors` (already a peer dep of `@workkit/notify`).
- ✅ Consumers that *do* want the metadata can check it.
- ❌ Two ways to encode the same information: the legacy stringified `error` plus the new structured fields. Adapter authors have to populate both.

### Option B — Pass the underlying error through

```ts
interface AdapterSendFailedResult {
  status: "failed";
  error: string;
  cause?: WorkkitError;
}
```

- ✅ No information loss — consumer reads `cause.retryable`, `cause.retryStrategy`, `cause.context`, etc.
- ❌ Forces every consumer of `AdapterSendResult` to depend on `@workkit/errors`'s `WorkkitError` class shape.
- ❌ Couples the public adapter contract to a *class*, not just a *type* — class identity is brittle across versions of `@workkit/errors` (instanceof checks break when two copies are bundled).
- ❌ Adapter authors who don't use `@workkit/errors` (e.g. wrapping a third-party SDK that throws plain `Error`) would have to construct a `WorkkitError` just to populate this field.

### Option C — New typed result for failures (`Result`-style discriminated union)

Replace `{ status, error?, providerId? }` with a tagged union: `{ ok: true, providerId } | { ok: false, error, retryable?, retryStrategy? }`.

- ✅ Cleanest type story.
- ❌ Breaking change for every existing adapter (custom + ours). Per decision driver #2, ruled out for now.

## Decision

**Option A.** Extend `AdapterSendResult` with optional `retryable?: boolean` and `retryStrategy?: RetryStrategy` fields on the failure shape. Update `cloudflareEmailProvider` and `resendEmailProvider` to populate both when they catch a `WorkkitError` (using the existing `WorkkitError.retryable` and `.retryStrategy` accessors). Other adapters (in-app, WhatsApp, custom) are not migrated in the same change — the new fields are optional and they keep their current behavior.

A thin convenience helper `adapterFailedFromError(err)` is added inside `@workkit/notify`'s adapter code to standardize the conversion (catch → `AdapterSendResult`) so adapter authors don't have to inline the `instanceof WorkkitError` check.

## Out of scope (deliberately)

1. **`createNotifyConsumer` retry policy.** The consumer continues to run the dispatch pipeline and surface failures to the queue consumer; it does not yet act on the new `retryable` / `retryStrategy` fields. That requires touching `@workkit/queue`'s ack/retry contract and is filed separately as a follow-up.
2. **Migration of in-app and WhatsApp adapters.** Their failure paths today either rarely hit `WorkkitError` or wrap their own provider errors. Migrating them is mechanical follow-up work; the new fields stay optional so this isn't a breaking gap.
3. **Persistence of retry metadata in delivery records.** The `notification_deliveries` table writes `error` (text). Adding `retryable` / `retry_strategy` columns is a schema migration; tracked separately.

## Consequences

### Positive

- The CF + Resend providers stop discarding the retry metadata at the boundary.
- Future consumers (custom orchestrators, observability dashboards, queue-side retry policy) can read structured retry hints out of `AdapterSendResult` without re-parsing the `error` string.
- The change is non-breaking for all existing adapters and consumers.

### Negative

- Two-stage rollout: the metadata flows through the result type but isn't yet consumed by `createNotifyConsumer`. Until the consumer-side follow-up lands, the only observable benefit is the structured fields being readable from the result.
- Two encodings of the same information (`error: string` plus `retryable + retryStrategy`) — by design, but adapter authors must remember to populate both for full fidelity.

### Follow-up issues

- Wire `createNotifyConsumer` (and downstream `@workkit/queue` orchestration) to consult the new fields when deciding to ack vs retry. **NEW.**
- Migrate the in-app + WhatsApp adapters to populate retry hints from their internal failure modes. **NEW.**
- Schema migration: add `retryable` + `retry_strategy_kind` columns to `notification_deliveries` so the metadata persists. **NEW.**
