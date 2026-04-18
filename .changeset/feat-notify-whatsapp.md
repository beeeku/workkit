---
"@workkit/notify": minor
---

Add **WhatsApp** transport adapter as a subpath import of `@workkit/notify`
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
