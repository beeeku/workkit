---
"@workkit/notify": minor
---

Add `@workkit/notify` core — unified notification dispatch for Cloudflare
Workers. One API, pluggable transport adapters. Owns the cross-cutting
concerns once: recipient resolution, channel preferences, opt-out registry,
quiet hours (IANA timezone, DST-safe), idempotency
(`UNIQUE(idempotency_key)` over canonical-JSON SHA-256), declarative
fallback chains, delivery records, test mode.

- **`define({ id, schema, channels, fallback, priority })`** — Standard
  Schema validates the payload; duplicate channels in `fallback` and unknown
  channels rejected at definition.
- **`createNotifyConsumer(deps, lookup)`** — queue-consumer factory that
  runs the full dispatch pipeline (idempotency → recipient → prefs → opt-out
  → quiet-hours → adapter → records).
- **`dispatch(deps, registry, input)`** — lower-level pipeline.
- **`webhookHandler({ channel, db, registry, secret })`** — framework-
  agnostic `(Request) => Promise<Response>` with signature verification +
  5-min replay window.
- **`forgetUser(db, userId)`** — cascade delete for GDPR / India DPDP.
- **`purgeOlderThan(db, olderThanMs)`** — retention helper.
- D1 migration SQL exported via `ALL_MIGRATIONS`.
- Adapter interface stable: `{ send, parseWebhook?, verifySignature? }`.

Out of scope (separate issues): WhatsApp adapter (#29), email adapter (#27),
in-app adapter (#28), queue-side drain on `forgetUser`, template registry.

Closes #26.
