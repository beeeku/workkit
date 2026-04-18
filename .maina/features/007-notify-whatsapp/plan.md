# Implementation Plan — @workkit/notify/whatsapp

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: factory `whatsappAdapter(options)` returns `Adapter<WhatsAppPayload>`. The `provider` is pluggable: `metaWaProvider({...})`, `twilioWaProvider({...})` (stub), `gupshupWaProvider({...})` (stub).
- **Layering** (under `packages/notify/src/adapters/whatsapp/`):
  - `adapter.ts` — `whatsappAdapter`; orchestrates opt-in check → DND → 24h-window route → provider call → marketing-pause check.
  - `provider.ts` — `WaProvider` interface + shared types.
  - `providers/meta.ts` — Meta WA Cloud API impl (send, parseWebhook, verifySignature, uploadMedia, handleVerificationChallenge).
  - `providers/twilio.ts`, `providers/gupshup.ts` — stubs.
  - `opt-in.ts` — D1 schema + `recordOptIn`/`isOptedIn`/`revokeOptIn`/check helpers.
  - `media-cache.ts` — `R2 etag → providerMediaId` cache (D1-backed; 30d TTL).
  - `session-window.ts` — track inbound timestamp per recipient; `withinSessionWindow(at)` predicate.
  - `marketing-pause.ts` — in-memory pause flag; emits audit event when toggled.
  - `keywords.ts` — multi-locale STOP/UNSUBSCRIBE keyword matcher.
  - `phone.ts` — E.164 validation + cipher hook (encrypt/decrypt callbacks).
  - `errors.ts` — `OptInRequiredError`, `TemplateNotApprovedError`, `WhatsAppPhoneFormatError`, `WebhookSignatureError`.
  - `forget.ts` — `forgetWhatsAppUser` cascade.
  - `schema.ts` — `WA_OPTIN_MIGRATION_SQL`, `WA_MEDIA_CACHE_MIGRATION_SQL`, `WA_INBOUND_LOG_MIGRATION_SQL`.

## Key Technical Decisions

- **Direct `fetch` to Meta Graph API** (`https://graph.facebook.com/v20.0/{phoneNumberId}/messages`) — same pattern as the email adapter; no SDK.
- **Provider as object, not class** — stateless, easy to swap, easy to test.
- **24h window via D1**: `wa_inbound_log(user_id, last_inbound_at)` — updated on every inbound webhook event. `withinSessionWindow` reads this in-line; routing decided pre-send. Pluggable via callback for callers using DOs.
- **Marketing pause** — `MarketingPauseRegistry` class with `pause()/resume()/isPaused()`. Adapter consults it before sending `category: marketing` templates. Quality-rating webhooks call `pause()`. Caller-callable `resume()` for human review.
- **Opt-in proof contract** — adapter expects an injected `optInChecker(userId)` callback. Default `db`-backed implementation reads from `wa_optin_proofs` table; callers can swap for their own user-table integration.
- **Phone cipher** — `phoneCipher: { encrypt(plain): Promise<string>; decrypt(cipher): Promise<string> }`. Optional; default identity (plain E.164 stored).
- **Multi-locale STOP keywords** — small allowlist: `STOP, STOP ALL, UNSUBSCRIBE, REMOVE` (EN); `रोक, बंद` (HI); `ALTO, BAJA` (ES); `ARRÊT, STOP` (FR). Case-insensitive, whitespace-trimmed. Caller can extend via `extraStopKeywords: string[]`.
- **DND check** — caller-supplied `dndCheck(phoneE164): Promise<boolean>` callback. Adapter only calls it for `category: marketing`. Returns true ⇒ skip send (record `status: skipped`).
- **Signature verification** — Meta uses `X-Hub-Signature-256: sha256=<hex>`. HMAC-SHA256 of raw body with the app secret.
- **Webhook GET-handshake** — Meta sends `?hub.mode=subscribe&hub.challenge=<n>&hub.verify_token=<t>` on initial setup. `provider.handleVerificationChallenge(req, verifyToken)` returns the challenge if `verify_token` matches, else 403.

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/notify/package.json` | Add `./whatsapp` subpath export | Modified |
| `packages/notify/bunup.config.ts` | Add whatsapp entry | Modified |
| `packages/notify/src/adapters/whatsapp/adapter.ts` | `whatsappAdapter` orchestrator | New |
| `packages/notify/src/adapters/whatsapp/provider.ts` | `WaProvider` interface + send/event/media types | New |
| `packages/notify/src/adapters/whatsapp/providers/meta.ts` | Meta WA Cloud API impl | New |
| `packages/notify/src/adapters/whatsapp/providers/twilio.ts` | Stub (throw) | New |
| `packages/notify/src/adapters/whatsapp/providers/gupshup.ts` | Stub (throw) | New |
| `packages/notify/src/adapters/whatsapp/opt-in.ts` | D1 helpers + `OptInRequiredError` check | New |
| `packages/notify/src/adapters/whatsapp/media-cache.ts` | etag→mediaId cache | New |
| `packages/notify/src/adapters/whatsapp/session-window.ts` | inbound log + 24h check | New |
| `packages/notify/src/adapters/whatsapp/marketing-pause.ts` | `MarketingPauseRegistry` | New |
| `packages/notify/src/adapters/whatsapp/keywords.ts` | multi-locale STOP matcher | New |
| `packages/notify/src/adapters/whatsapp/phone.ts` | E.164 validate + cipher hook | New |
| `packages/notify/src/adapters/whatsapp/errors.ts` | adapter-specific errors | New |
| `packages/notify/src/adapters/whatsapp/forget.ts` | cascade | New |
| `packages/notify/src/adapters/whatsapp/schema.ts` | D1 migration SQL | New |
| `packages/notify/src/adapters/whatsapp/index.ts` | public exports for `./whatsapp` subpath | New |
| `packages/notify/tests/adapters/whatsapp/*.test.ts` | provider, opt-in, session-window, keywords, phone, adapter | New |
| `packages/notify/README.md` | add WhatsApp section | Modified |
| `.changeset/feat-notify-whatsapp.md` | `@workkit/notify` minor — adds whatsapp subpath | New |

## Tasks (TDD)

1. update `package.json` exports + `bunup.config.ts` entry
2. impl:errors + impl:schema
3. test:keywords → impl:keywords
4. test:phone → impl:phone
5. test:opt-in → impl:opt-in
6. test:session-window → impl:session-window
7. test:marketing-pause → impl:marketing-pause
8. test:media-cache → impl:media-cache
9. test:provider:meta → impl:providers/meta (uses ^)
10. impl:providers/twilio + impl:providers/gupshup (stubs)
11. test:adapter → impl:adapter (orchestrator)
12. impl:forget
13. wire `src/adapters/whatsapp/index.ts`
14. README + changeset
15. lint + typecheck + scoped tests
16. maina verify
17. maina commit + push + PR
18. request review

## Failure Modes

- **Missing/revoked opt-in proof** → `OptInRequiredError` from adapter; row not sent.
- **Phone not E.164** → `WhatsAppPhoneFormatError` pre-send.
- **Quality rating dropped (Meta webhook)** → marketing-pause flag set; subsequent `category: marketing` sends return `status: skipped` with reason `marketing-paused`. Audit row written.
- **DND blocked** → `status: skipped` with reason `dnd`.
- **Outside 24h window + no template** → adapter returns `status: failed` with `cannot send session message outside 24h window`.
- **Template variable count mismatch** → `TemplateNotApprovedError` (sub-class for variable mismatch) pre-send.
- **Meta provider 4xx** (e.g., template not approved, account suspended) → normalize to `TemplateNotApprovedError` or pass-through `status: failed` with provider error.
- **Meta provider 429** → `status: failed`; queue retry policy handles backoff.
- **Webhook signature mismatch** → adapter `verifySignature` returns false; notify-core's webhookHandler returns 401.
- **Webhook GET-handshake mismatch** (wrong verify_token) → `handleVerificationChallenge` returns null; route returns 403.
- **Inbound STOP** → automatic opt-out via the configured hook; webhook returns 200.
- **R2 media object missing** → fail fast with explicit error; no partial media reference sent.

## Testing Strategy

- All unit tests; no live Meta calls.
- Reuse the `better-sqlite3`-backed D1 mock from #39 for opt-in/media-cache/session-window queries.
- Hand-rolled `fetch` mock (vi.fn) for Meta API.
- Webhook signature tested with a known-good HMAC-SHA256 (sha256=<hex>) pair generated inline.
- Multi-locale keyword matching tested against EN/HI/ES/FR samples.

## Stacking

- Branch: `feature/007-notify-whatsapp`
- Base: `feature/006-notify-adapters` (needs the same package.json/bunup multi-entry surface)
- After #39 merges: rebase onto master so this PR's diff shows only whatsapp.


## Wiki Context

Auto-populated; no edits.
