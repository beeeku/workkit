# Implementation Plan — @workkit/notify (core)

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: functional. `notify.define({...})` returns a `Notification` with `.send(payload)`. Module-level `notify.adapter(name, impl)` registers transport adapters. `notify.consumer(opts)` returns a queue consumer that handles dispatch + delivery.
- **Two-stage delivery**:
  1. `Notification.send(payload)` enqueues `DispatchJob { id, userId, notificationId, payloadHash, payload, idempotencyKey, attemptedChannels: [] }`.
  2. Queue consumer dequeues, runs the **dispatch pipeline** (recipient resolve → opt-out check → quiet-hours check → idempotency check → adapter call), records delivery, retries via fallback chain.
- **Layering**:
  - `define.ts` — `notify.define`, returns typed `Notification`.
  - `send.ts` — enqueue logic; canonical hashing.
  - `dispatch.ts` — pipeline that runs inside the consumer; handles fallback.
  - `preferences.ts` — read user prefs + channel ordering.
  - `opt-out.ts` — opt-out registry queries.
  - `quiet-hours.ts` — IANA timezone window check + DST handling.
  - `records.ts` — D1 delivery records read/write/purge.
  - `idempotency.ts` — canonical-JSON sort + SHA-256.
  - `adapters.ts` — adapter registry + interface types.
  - `webhooks.ts` — framework-agnostic `Request → Response` for delivery-status webhooks; routes by channel.
  - `consumer.ts` — `createNotifyConsumer({ db, adapters, ...deps })` returning a queue consumer fn.
  - `forget.ts` — `notify.forgetUser(userId)` D1 cascade.
  - `schema.ts` — D1 migration SQL strings.
- **Integration points**: `@workkit/queue` for enqueue/consume; `@workkit/d1` for queries; `@workkit/ratelimit` for per-user gating; `@workkit/errors` for normalized errors; `@standard-schema/spec` for payload schemas.

## Key Technical Decisions

- **Dispatcher checks opt-out at consumer time** (race-safe). Document that prefs read at enqueue is for fast-path skip only — the authoritative check is at dispatch.
- **Idempotency key composition**: `sha256(canonicalJson({ userId, notificationId, payload }))`. Caller can override with explicit `idempotencyKey` to dedupe across retries.
- **Canonical JSON**: recursively sort object keys before stringify; reject NaN/Infinity (caller error).
- **Quiet hours window**: stored as `start`/`end` strings (HH:mm) plus `timezone` (IANA). Computed via `Intl.DateTimeFormat` on the dispatch moment; handles midnight wrap (`start: "22:00"`, `end: "06:00"`).
- **Priority bypass allowlist** is a registry-level config, not per-call: `notify.config({ priorityAllowlist: [...] })`. Random product code can't bypass quiet hours by setting `priority: "high"`.
- **Adapter shape**:
  ```ts
  interface Adapter<P = unknown> {
    send(args: AdapterSendArgs<P>): Promise<AdapterSendResult>;
    parseWebhook?(req: Request): Promise<WebhookEvent[]>;
    verifySignature?(req: Request, secret: string): Promise<boolean>;
  }
  ```
- **Webhook helper** is framework-agnostic: `notify.webhookHandler({ channel })` returns `(req: Request) => Promise<Response>`. Callers wrap in their own router.
- **All-channel-opted-out yields `status:'skipped'`**, recorded as a single delivery row per userId+notificationId.
- **Test mode** is checked at `dispatch.ts` immediately before `adapter.send()`; logged as a "test sink" delivery row (without payload PII when verbose=false).

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/notify/package.json` etc. | Manifest + build/test config | New |
| `packages/notify/src/index.ts` | Public exports | New |
| `packages/notify/src/types.ts` | Public type surface | New |
| `packages/notify/src/define.ts` | `notify.define` | New |
| `packages/notify/src/send.ts` | enqueue + canonical hashing | New |
| `packages/notify/src/dispatch.ts` | dispatcher pipeline | New |
| `packages/notify/src/preferences.ts` | prefs queries | New |
| `packages/notify/src/opt-out.ts` | opt-out registry queries | New |
| `packages/notify/src/quiet-hours.ts` | IANA timezone window check | New |
| `packages/notify/src/records.ts` | delivery records read/write/purge | New |
| `packages/notify/src/idempotency.ts` | canonical JSON + SHA-256 | New |
| `packages/notify/src/adapters.ts` | adapter registry + types | New |
| `packages/notify/src/webhooks.ts` | framework-agnostic webhook handler | New |
| `packages/notify/src/consumer.ts` | queue consumer factory | New |
| `packages/notify/src/forget.ts` | `forgetUser` cascade | New |
| `packages/notify/src/config.ts` | global config (priorityAllowlist) | New |
| `packages/notify/src/schema.ts` | D1 migration SQL | New |
| `packages/notify/src/errors.ts` | notify-specific errors | New |
| `packages/notify/tests/idempotency.test.ts` | canonical hashing | New |
| `packages/notify/tests/quiet-hours.test.ts` | timezone + midnight wrap | New |
| `packages/notify/tests/define.test.ts` | duplicate-channel rejection, priority allowlist | New |
| `packages/notify/tests/dispatch.test.ts` | opt-out re-check, fallback chain, idempotency UNIQUE, all-opted-out → skipped | New |
| `packages/notify/tests/forget.test.ts` | cascade delete | New |
| `packages/notify/tests/_mocks.ts` | mock D1, queue, adapter | New |
| `packages/notify/README.md` | Public docs | New |
| `.changeset/feat-notify-init.md` | `@workkit/notify@0.1.0` | New |

## Tasks (TDD red→green)

1. **scaffold**
2. **test:idempotency** → **impl:idempotency**
3. **test:quiet-hours** → **impl:quiet-hours**
4. **test:define** → **impl:define + adapters registry + config**
5. **test:dispatch** → **impl:dispatch + preferences + opt-out + records**
6. **impl:webhooks**
7. **impl:consumer + send (enqueue)**
8. **test:forget** → **impl:forget**
9. **wire src/index.ts**
10. lint/typecheck/scoped tests
11. maina verify
12. changeset
13. maina commit
14. push + PR
15. request review

## Failure Modes

- **Opt-out raced past enqueue** — covered by dispatch-time re-check (test asserts).
- **Quiet hours midnight wrap** — explicit branch in `quiet-hours.ts`; test covers `start > end`.
- **DST edge** — using `Intl.DateTimeFormat` with the user's IANA tz (not arithmetic) sidesteps offset bugs.
- **Idempotency collision** — D1 `UNIQUE` catches; surface as `status:'duplicate'`, do not throw.
- **All adapters fail** — record final status as `failed`; emit a logger event at error level. Caller is on the hook for retry policy beyond the in-package fallback chain.
- **Adapter throws** — caught in dispatch, recorded as `failed` for that channel, fallback continues.
- **Canonical JSON crash on circular ref** — guard with `try/catch`, return `ValidationError` to the caller (caller's payload bug).

## Testing Strategy

- **Unit tests** with hand-rolled D1 mock (in-memory map keyed by table+pk) and a hand-rolled queue mock.
- **Adapter tests deferred** — adapters land in #27/#28/#29 with their own test surfaces.
- **No e2e** — adapter-bound; covered when each adapter PR ships.


## Wiki Context

Auto-populated; no edits.
