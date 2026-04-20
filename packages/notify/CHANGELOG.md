# @workkit/notify

## 1.0.0

### Minor Changes

- 44ece4c: **Preserve retry semantics through adapter `send()` results.** `AdapterSendResult` now carries optional `retryable?: boolean` and `retryStrategy?: RetryStrategy` fields on failures, so the provider's classification of "this is transient, retry with backoff" vs "this is terminal, don't retry" survives the boundary into the dispatch pipeline. See [ADR-002](.maina/decisions/002-notify-adapter-retry-semantics.md).

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

- cf7844c: **Add `createBounceRoute` to `@workkit/notify/email` for Cloudflare-transport bounce handling.** The Cloudflare `send_email` binding has no delivery-webhook surface, so the Resend-style `autoOptOut` path isn't available on `cloudflareEmailProvider`. This helper closes the gap: feed an inbound DSN routed via Cloudflare Email Routing into the same `EmailOptOutHook` shape your Resend setup uses.

  ```ts
  import { createEmailRouter } from "@workkit/mail";
  import { createBounceRoute } from "@workkit/notify/email";
  import { optOut } from "@workkit/notify";

  const bounces = createBounceRoute({
    optOutHook: async (address, channel, _nid, reason) => {
      const userId = await lookupUserIdByEmail(address);
      if (userId) await optOut(env.DB, userId, channel, null, reason);
    },
  });

  export default {
    email: createEmailRouter()
      .match((e) => e.to === "bounces@yourdomain.com", bounces)
      .default((e) => e.setReject("Unknown recipient")).handle,
  };
  ```

  Hard bounces (RFC 3463 `5.x`) fire the opt-out hook with `reason: "hard-bounce"`; soft bounces (`4.x`) no-op so transient failures don't silently drop subscribers; non-DSN messages route through the optional `onNonBounce` callback (or are dropped). Hook errors propagate so the MTA retries.

  Built on `parseBounceDSN` from `@workkit/mail` (same release).

  Closes #54.

- af3268a: **Add `sesEmailProvider` and `postmarkEmailProvider` stubs to `@workkit/notify/email`.** Mirrors the WhatsApp adapter's existing stub pattern (`twilioWaProvider`, `gupshupWaProvider`) — `send` / `parseWebhook` / `verifySignature` throw `NotImplementedError` with a link to the tracking issue (#57), but the option types, the conformance to `EmailProvider`, and the export surface are stable so a real implementation can drop in without touching the adapter or caller code.

  ```ts
  import {
    emailAdapter,
    sesEmailProvider,
    postmarkEmailProvider,
  } from "@workkit/notify/email";

  // Same emailAdapter, different provider — the adapter is provider-agnostic.
  const ses = emailAdapter({
    provider: sesEmailProvider({
      region: "us-east-1",
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      from: "Reports <reports@entryexit.ai>",
    }),
  });
  ```

  Closes #57.

### Patch Changes

- a625323: **Fix module-init crash in workerd: drop top-level `createRequire(import.meta.url)` from the bundle.** Bunup's default Node-target build emitted a top-level `import { createRequire } from "node:module"; var __require = createRequire(import.meta.url);` shim. Under workerd, `import.meta.url` is `undefined` for non-entry-point modules, so `createRequire(undefined)` threw synchronously at module load — blocking any Cloudflare Worker that imported (directly or transitively) `@workkit/agent` or `@workkit/notify` from booting.

  Both packages now build with `target: "browser"`, which switches bunup to a self-contained `__require` shim that has no top-level side effects. The shim only throws if a caller actually performs a dynamic `require()` — which neither package does. No source changes; no API changes.

  Closes #64.

- Updated dependencies [b26dbbc]
- Updated dependencies [cf7844c]
  - @workkit/errors@1.0.4
  - @workkit/mail@0.2.0

## 0.2.0

### Minor Changes

- fd832ae: **Cloudflare `send_email` is now the default email transport.** `@workkit/notify`'s email adapter is refactored to be provider-pluggable (matching the WhatsApp provider pattern), with `cloudflareEmailProvider` as the default and `resendEmailProvider` as the first-class alternative. Closes #52.

  **Breaking — `emailAdapter` options shape (pre-1.0).** The `{ apiKey, from, ... }` shape is removed. Callers must explicitly pass a provider:

  ```diff
  - emailAdapter({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } })
  + emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } }) })
  ```

  Or switch to the new zero-config default:

  ```ts
  emailAdapter({
    provider: cloudflareEmailProvider({
      binding: env.SEND_EMAIL,
      from: "noreply@x.com",
    }),
  });
  ```

  `autoOptOut` now lives on the Resend provider (where webhook events originate); the Cloudflare provider has no delivery webhooks and no `autoOptOut` — bounce synthesis from inbound DSN is tracked in the roadmap (#53 / #54).

  **`@workkit/mail` added as optional peerDependency on `@workkit/notify`.** Only users of `cloudflareEmailProvider` install it.

  **`@workkit/testing` gains `createMockSendEmail` and `createMockForwardableEmail`** — promoted from a private helper in `@workkit/mail`. Matches the `createMockKV` / `createMockD1` / `createMockR2` pattern. `@workkit/mail` tests migrated to consume these.

  **`WebhookSignatureError`** takes a `provider: "resend" | "cloudflare"` arg; error messages now indicate which provider failed verification.

  Follow-ups filed: #53 (parseBounceDSN), #54 (createBounceRoute), #55 (retry strategy in AdapterSendResult), #56 (docs positioning), #57 (SES/Postmark provider stubs).

### Patch Changes

- Updated dependencies [fd832ae]
  - @workkit/mail@0.1.1

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
