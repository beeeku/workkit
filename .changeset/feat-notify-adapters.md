---
"@workkit/notify": minor
---

Add **email** and **in-app** transport adapters as subpath imports of
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
