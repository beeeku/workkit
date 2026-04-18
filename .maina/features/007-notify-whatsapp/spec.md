# Feature: @workkit/notify/whatsapp — WhatsApp transport adapter

Tracks GitHub issue #29. Lands as a subpath of `@workkit/notify` (matching the email + inapp adapters in #39). Stacked on `feature/006-notify-adapters`; will rebase onto master after that PR merges.

## Problem Statement

`@workkit/notify` core (#26) + email/inapp adapters (#39) ship without WhatsApp. WhatsApp is the dominant transactional channel in India (entryexit.ai's primary market) and a strong differentiator vs email-only flows globally. Without an adapter, every product wires Meta/Twilio/Gupshup directly and re-implements the same compliance story (DND India, opt-in proofs, 24h session window, hard-bounce/quality drop handling).

The provider landscape is messy:
- **Meta WhatsApp Business Cloud API** is the primary path: free 1,000 conversations/mo, no BSP markup, global. Direct HTTP API.
- **Twilio** is the global onboarding-friendly path: per-message margin, simpler dashboard, no need for Meta Business verification.
- **Gupshup** dominates the Indian market: Hindi templates, INR billing, local support.

Build the adapter so the provider is pluggable behind a stable interface; ship Meta direct as the reference implementation; stub Twilio/Gupshup with explicit "not implemented" so callers can fill them in without forking.

## Target User

- **Primary**: workkit consumers needing transactional WhatsApp delivery (entryexit's pre-market briefs first; future SaaS products with Indian/global reach next).
- **Secondary**: workkit/community contributors filling in Twilio/Gupshup providers.
- **Compliance engineers**: ensure DND India + Meta opt-in requirements + 24h-window enforcement land in code, not in tribal knowledge.

## User Stories

- As a product engineer, I want `whatsappAdapter({ provider: metaWaProvider({...}) })` registered as the `whatsapp` channel.
- As a security engineer, I want webhook signatures verified per provider (Meta uses `X-Hub-Signature-256`).
- As a compliance engineer, I want pre-send opt-in proof checks and DND India lookups for marketing-category templates.
- As an SRE, I want quality-rating webhook events to automatically pause `category: marketing` sends pending review.
- As a developer, I want to send approved templates AND session messages within the 24h customer service window — the adapter routes automatically based on the conversation state.
- As a developer, I want media attachments to fetch from R2 with a cached `etag → mediaId` mapping so the same R2 object isn't re-uploaded per recipient.

## Success Criteria

- [ ] `whatsappAdapter({ provider, webhook?, optIn, ... })` returns `Adapter<WhatsAppPayload>` registered as the `whatsapp` channel.
- [ ] **Provider interface** stable: `send`, `parseWebhook`, `verifySignature`, optional `uploadMedia`, optional `handleVerificationChallenge` (Meta GET handshake).
- [ ] **Meta provider** fully implemented (direct `fetch` to Graph API).
- [ ] **Twilio + Gupshup providers** stubbed with `throw new Error("not implemented — see #29 for tracking")` and a clear extension point.
- [ ] **24h session window** detected automatically — outside window forces template send; inside window allows session messages.
- [ ] **Template variable validation** pre-send: count must match approved template's placeholder count; per-variable length capped at 1024 chars (WA max).
- [ ] **Phone number E.164 enforcement** — adapter rejects malformed numbers before provider call.
- [ ] **Inbound STOP/UNSUBSCRIBE keywords** (multi-locale: EN, HI, ES, FR) automatically opt-out the user via the injected hook.
- [ ] **Opt-in proof storage** — D1 schema (`wa_optin_proofs`) + `recordOptIn` helper. Adapter MUST check this table pre-send; missing/revoked rows → `OptInRequiredError`.
- [ ] **DND India** check for `category: "marketing"` templates only (transactional exempt). Pluggable `dndCheck` callback.
- [ ] **Quality-rating webhook** (Meta `account_update.phone_quality`) automatically pauses `category: marketing` sends; emits an audit event.
- [ ] **Webhook signature verified** per provider; replay window enforced (5 min).
- [ ] **Media upload caching** — `R2 etag → providerMediaId` cache. Default 30d TTL (matches Meta retention).
- [ ] **Phone numbers encrypted at rest** — adapter exposes `phoneCipher` callback for caller-supplied AES-GCM encrypt/decrypt.
- [ ] **`forgetWhatsAppUser(db, userId)`** cascades through `wa_optin_proofs` + `wa_media_cache` (caller's user_id-keyed rows).
- [ ] `@workkit/testing` integration present.
- [ ] LOC budget ≤700 source for the whatsapp subpath (ambitious — Meta provider alone is ~250 LOC).
- [ ] Single subpath export `@workkit/notify/whatsapp`.
- [ ] Changeset added.

## Scope (v1 PR)

### In Scope

- `whatsappAdapter(options)` returning `Adapter<WhatsAppPayload>`.
- Provider interface (`WaProvider`).
- **Meta provider** (`metaWaProvider`) fully implemented:
  - Template + session send via Graph API.
  - Media upload via Graph API; R2-etag cache.
  - Webhook GET-verification challenge handler.
  - `X-Hub-Signature-256` HMAC-SHA256 webhook signature verification.
  - Event parser: `messages.statuses.delivered/read/sent/failed`, `messages` (inbound), `account_update.phone_quality` (quality alerts).
- **Twilio + Gupshup providers** stubbed (signature verification + 1-line throw).
- Opt-in proof storage (D1 schema + helpers).
- Quality-rating-driven marketing pause (in-memory flag for v1; per-account D1 row in v2).
- Multi-locale STOP keyword recognition.
- DND India callback hook.
- Phone-number E.164 validation + cipher hook.
- `WA_OPTIN_MIGRATION_SQL` + `WA_MEDIA_CACHE_MIGRATION_SQL` schema exports.
- `forgetWhatsAppUser` cascade.

### Out of Scope (separate concerns)

- Two-way conversational flows / agent integration (caller wires `@workkit/agent`).
- Rich interactive templates (buttons, lists) — start with text + media in v1.
- Twilio + Gupshup full implementations (community contribution / future PRs).
- Cross-account quality-rating coordination (single Worker isolate scope for the marketing-pause flag in v1; multi-isolate via DO is future).
- BSP migration tooling.

## Design Decisions

- **Meta direct as the default reference impl** — no per-message margin, free first 1k conversations/mo, global. Documented as the recommended path.
- **Provider interface, not BSP-locked** — Twilio + Gupshup stubs included so the upgrade path is "swap one factory call" not "fork the package".
- **24h session window inferred from conversation state**, not from caller — adapter tracks the most recent inbound message timestamp per recipient (D1) and auto-routes template-vs-session.
- **Opt-in proof check is pre-send** — refuses to call the provider without a row. Surface as `OptInRequiredError` so callers can render a "verify your WhatsApp" UI flow rather than ship a silent failure.
- **DND check is a callback** — workkit doesn't ship DND India integration (TRAI registry has its own auth flow); we expose the integration point and keep the rest of the pipeline intact.
- **Quality-rating pause is per-isolate in v1** — getting cross-isolate fan-out right requires a Durable Object. Acceptable for v1 because Meta's quality metric is slow-moving; a 30-second propagation gap is fine.
- **Phone-number cipher is opt-in** — caller supplies an AES-GCM key + encrypt/decrypt callback. Default mode stores plain E.164 (consumer can switch later without schema migration since the column is `BLOB`-friendly).
- **Webhook GET-verification challenge handler** is exposed as `provider.handleVerificationChallenge(req, verifyToken)` — Meta requires a one-shot GET handshake on webhook setup; the helper handles it inline.
- **Media cache key is `r2://<key>:<etag>`** — etag changes invalidate the cached upload automatically.

## Open Questions

- Is the multi-locale STOP keyword list canonical enough for v1, or do we delegate to caller? — Lean: ship a small allowlist (EN/HI/ES/FR), document, let callers extend.
- Should the marketing-pause flag persist across deploys? — v1 in-memory, v2 D1 row. Documented.
- Do we need a per-recipient session-window override (e.g., "force template even within 24h")? — Yes, optional `sendOptions.forceTemplate: true`.
