# @workkit/notify

## 0.1.0

### Minor Changes

- 6603aa5: Add **email** and **in-app** transport adapters as subpath imports of
  `@workkit/notify`. Closes #27 (email) and #28 (in-app). WhatsApp (#29)
  lands separately.

  ### Email — `@workkit/notify/email`

  - `emailAdapter({ apiKey, from, replyTo?, bucket?, webhook?, autoOptOut?, markUnsubscribable? })` — direct `fetch` to Resend (no SDK).
  - Optional `@react-email/render` peer for React Email components; plain
    HTML strings work without it.
  - Plain-text fallback auto-generated via `htmlToText`.
  - Webhook signature verified via Svix-format `v1,<base64>` HMAC-SHA256
    with 5-min replay window. Accepts both whitespace- and comma-separated
    multi-variant signatures.
  - Hard bounce + complaint → automatic opt-out via injected hook
    (configurable, default on).
  - Attachment cap default 40MB; bounded R2 fetch concurrency 4; chunked
    base64 encoder for performance.
  - `markUnsubscribable` allowlist attaches `List-Unsubscribe` headers for
    sensitive notification ids.
  - From-domain validated at adapter init.
  - Exported helpers: `renderEmail`, `htmlToText`, `parseResendEvents`,
    `verifyResendSignature`, `isComplaint`, `isHardBounce`, `loadAttachments`.

  ### In-app — `@workkit/notify/inapp`

  - `inAppAdapter({ db, registry?, maxBodyChars?, allowedSchemes? })` —
    inserts D1 rows + best-effort push to active SSE subscribers.
  - `feed`, `markRead`, `dismiss`, `unreadCount` query helpers.
  - Composite opaque `(created_at, id)` cursor; cross-user enumeration
    blocked by ownership-checked `WHERE` clauses.
  - `markRead`/`dismiss` only update rows owned by the supplied `userId`.
  - `markRead({ markAll: true })` for "mark everything".
  - `SseRegistry` + `createSseHandler` — auth callback **required** at
    construction (no anonymous default), per-user connection cap (default
    5), origin allowlist, 30s heartbeat.
  - `safeLink(url)` rejects `javascript:`/`data:`/`file:` and other
    non-allowlisted schemes; `https:` only by default.
  - Body length cap default 2KB.
  - `forgetInAppUser(db, userId, registry?)` cascades + drops active SSE
    subscribers for the user.
  - `INAPP_MIGRATION_SQL` — D1 schema for `in_app_notifications` (incl.
    unread + created indexes).

  ### Notable changes vs the earlier closed PR (#38, separate package)

  - Restructured to subpath imports per the original #26 spec; one package,
    one changeset.
  - Renamed `disableTrackingFor` → `markUnsubscribable` (Resend has no
    public flag to disable open/click tracking; the option attaches
    `List-Unsubscribe` headers, which is what it actually does).
  - Removed dead `EmailAdapterOptions.webhook.secret` (verification gets
    the secret from notify-core's `webhookHandler`).
  - Removed unused `props` field from `renderEmail` (callers compose their
    own React element).
  - Switched `arrayToBase64` to chunked encoding (was O(n²)).
  - Svix signature parser handles both space- and comma-separated multi-
    variant headers.
  - `decodeSecret` wraps `atob` failure in `WebhookSignatureError`.
  - `parseWebhook` no longer throws on malformed JSON when auto-opt-out is
    enabled.

- 71698e2: Add `@workkit/notify` core — unified notification dispatch for Cloudflare
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

- 5a48fc0: Add **WhatsApp** transport adapter as a subpath import of `@workkit/notify`
  (`@workkit/notify/whatsapp`). Closes #29.

  ### Provider strategy

  - **Meta WhatsApp Business Cloud API** — fully implemented as the reference
    default. Direct `fetch` to Graph API; no SDK.
  - **Twilio + Gupshup** — stubs that throw `not implemented`. The provider
    interface is stable; concrete impls are a swap-in.

  ### Adapter (`whatsappAdapter({ provider, db, ... })`)

  - **Opt-in proof required pre-send** via D1-backed `wa_optin_proofs`
    table. Refuses to call the provider if the row is missing or revoked
    (`OptInRequiredError`).
  - **24h session window** detected from `wa_inbound_log` — outside the
    window forces template send; inside allows session text. Override via
    `forceTemplate: true`.
  - **DND India** check via injected callback, invoked only for
    `category: "marketing"` templates.
  - **`MarketingPauseRegistry`** — flipped on Meta `account_update.phone_quality`
    low/flagged webhooks; subsequent marketing sends fail with
    `MarketingPausedError`. Transactional sends unaffected.
  - **Inbound STOP/UNSUBSCRIBE keywords** (multi-locale: EN/HI/ES/FR;
    caller-extensible) trigger automatic opt-out via the injected hook.
  - **E.164 enforcement** (`WhatsAppPhoneFormatError` pre-send).
  - **Optional `phoneCipher`** for at-rest encryption (default identity).
  - **R2 etag → media-id cache** (D1-backed, default 30d TTL) so identical
    attachments aren't re-uploaded per recipient.
  - **Meta webhook handshake** — `provider.handleVerificationChallenge(req, verifyToken)`
    for the GET `?hub.mode=subscribe` setup flow.
  - **`X-Hub-Signature-256` HMAC-SHA256** signature verification.

  ### D1 schema

  Three tables: `wa_optin_proofs`, `wa_media_cache`, `wa_inbound_log`.
  Run `WA_ALL_MIGRATIONS` once.

  ### `forgetWhatsAppUser(db, userId)`

  Cascades through opt-in proof + inbound log. Caller invokes
  `@workkit/notify`'s `forgetUser` for the rest of the GDPR/DPDP cascade.

  ### Tests

  58 new unit tests across keywords, phone, opt-in, session-window,
  marketing-pause, media-cache, meta provider, adapter orchestrator, and
  forget. SQLite-backed `NotifyD1` mock (via `better-sqlite3`) exercises
  real SQL semantics.

  ### Out of scope (follow-ups)

  - Twilio + Gupshup concrete impls (community).
  - Cross-isolate marketing-pause coordination (DO).
  - Rich interactive templates (buttons, lists).

### Patch Changes

- Updated dependencies [2e8d7f1]
  - @workkit/errors@1.0.3
