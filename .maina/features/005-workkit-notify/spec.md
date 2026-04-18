# Feature: @workkit/notify core — unified notification dispatch

Tracks GitHub issue #26.

## Problem Statement

Without a unified notification primitive, every product builds its own WhatsApp + email + in-app stack and re-decides the cross-cutting concerns: recipient resolution, per-user channel preferences, opt-out/DND compliance, quiet hours, idempotency, retry/fallback chains, delivery records, per-user and per-provider rate limits, and test-mode safety. These concerns drift between channels and between products, and compliance bugs become eternal.

If we don't solve this, entryexit's pre-market briefs ship through three transport-per-package modules that each re-implement the same opt-out story, idempotency hashing, and quiet-hours window math — and a single GDPR/DPDP `forgetUser` request requires touching N codebases.

## Target User

- **Primary**: workkit consumers who need to send notifications across one or more channels (entryexit's pre-market brief delivery first; future SaaS products with similar fan-out next).
- **Secondary**: workkit adapter authors (#27 email, #28 in-app, #29 WhatsApp) who plug their transport into the core via a stable adapter interface.

## User Stories

- As a product engineer, I want `notify.define({ id, schema, channels, fallback, priority })` so I declare a notification once and the library handles dispatch + fallback consistently.
- As a product engineer, I want `notification.send({ ...payload })` to enqueue the dispatch (no synchronous delivery) so my request stays fast.
- As a security/compliance engineer, I want `notify.forgetUser(userId)` to atomically purge prefs, opt-outs, delivery records, and queued messages.
- As an SRE, I want a queryable delivery-records table so I can debug deliverability and opens.
- As a developer doing local work, I want `mode: "test"` to short-circuit at the very last step so I never accidentally page real users from a dev branch.

## Success Criteria

- [ ] `notify.define()` accepts a Standard Schema for the payload and a per-channel config map.
- [ ] `send()` enqueues to `@workkit/queue` (no synchronous transport call).
- [ ] **Opt-out re-checked at worker dispatch**, not only at enqueue (covered by tests).
- [ ] Idempotency key composes `(userId, notificationId, payloadHash)` with canonical-JSON hashing.
- [ ] Quiet-hours respect IANA timezone + midnight wrap (tests).
- [ ] Priority bypass restricted to a configurable allowlist of notification IDs.
- [ ] Duplicate channel in `fallback` rejected at `define()`.
- [ ] All-channel opt-out yields `status:'skipped'` not `'failed'`.
- [ ] `notify.forgetUser(userId)` cascades through prefs, opt-outs, deliveries (queued messages out of scope this PR — needs queue-side support).
- [ ] Delivery record retention configurable, default 90d.
- [ ] Test mode validated at the last step before adapter dispatch.
- [ ] Adapter interface stable; registration via `notify.adapter(name, impl)`.
- [ ] Webhook route helper for delivery-status updates.
- [ ] `@workkit/testing` integration present.
- [ ] Single `src/index.ts` export.
- [ ] Changeset added.
- [ ] LOC budget ≤900 source.

## Scope (v1 PR)

### In Scope

- `notify.define({ id, schema, channels, fallback, priority })` returning a `Notification` with a typed `send()`.
- Dispatcher (`enqueue` → `worker` two-step) using `@workkit/queue`.
- D1 schema + helpers for `notification_prefs`, `notification_optouts`, `notification_deliveries`.
- Recipient resolution (`Resolver` interface; consumer supplies the actual lookup).
- Quiet-hours + priority bypass.
- Opt-out registry (per channel + per notification id).
- Idempotency (`UNIQUE` on the dispatch key in D1).
- Per-user rate limiting integration (via `@workkit/ratelimit`).
- Test mode (`mode: "test"`).
- Adapter interface: `{ send, parseWebhook?, verifySignature? }`.
- `notify.adapter(name, impl)` registry.
- `notify.webhookHandler(channel)` Hono-compatible factory.
- `notify.forgetUser(userId)` D1 cascade.

### Out of Scope (separate issues)

- WhatsApp adapter (#29).
- Email adapter (#27).
- In-app adapter (#28).
- Per-provider rate limiting (lands with each adapter).
- Queue-side draining of pending messages on `forgetUser` (depends on `@workkit/queue` API gap).
- Delivery analytics dashboard.
- Template registry (D1/R2-backed editable templates).

## Design Decisions

- **Two-stage dispatch**: `notification.send()` → enqueue; the queue consumer (`createNotifyConsumer`) does pref check, opt-out check (re-read fresh), quiet-hours check, idempotency lookup, then adapter call. This is the only way to make opt-out race-safe.
- **Idempotency via D1 `UNIQUE`** on `idempotency_key` rather than a separate KV. Caller can pass `idempotencyKey` explicitly to dedupe across retries.
- **Canonical JSON hashing**: keys are sorted recursively before hashing so logically equal payloads hash identically.
- **Quiet-hours computed in the user's IANA timezone** at dispatch moment (not at send moment) so the window is correct after queue delay.
- **Adapter signature** mirrors the issue: `send(args)`, `parseWebhook?`, `verifySignature?`. Adapters are stateless objects registered by name.
- **`notify.forgetUser(userId)` is best-effort across D1 + queue.** D1 we own; queue draining is gap (documented).

## Open Questions

- Hashing algorithm: SHA-256 via Web Crypto (available in Workers). Confirm during implementation. ✅
- Default retention 90d — should we ship the cleanup job here or document as caller responsibility? — Lean: ship a `notify.purgeOlderThan(days)` helper; cron job is caller's. Confirmed.
- Webhook helper — Hono-only, or framework-agnostic `Request → Response`? — Lean framework-agnostic; a `hono` wrapper can land later.
