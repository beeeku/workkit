# Implementation Plan — @workkit/notify-email

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: factory function `emailAdapter(options)` returns an `Adapter<EmailPayload>` from `@workkit/notify`.
- **Layering**:
  - `adapter.ts` — `emailAdapter(options)` + `send` impl.
  - `render.ts` — React Email render bridge + plain-text fallback generator.
  - `webhook.ts` — Resend webhook event parser + Svix signature verify.
  - `attachments.ts` — R2 fetch with bounded concurrency + size cap.
  - `auto-opt-out.ts` — handler invoked from webhook to write opt-outs via injected callback.
  - `errors.ts` — adapter-specific errors.
- **Integration**: `@workkit/notify` (Adapter shape, types, optOut helper); `@react-email/render` optional peer; consumer-supplied `R2Bucket` for attachments.

## Key Technical Decisions

- **`fetch` directly against `https://api.resend.com/emails`** — no SDK; small surface, easy to mock.
- **`@react-email/render`** as optional peer; if absent, fall back to treating template as a plain HTML string.
- **`htmlToText`** — tiny inline implementation: strip script/style blocks, strip tags, decode entities, collapse whitespace.
- **Svix verification** — header format `v1,<base64-sha256>`, secret prefix `whsec_`. Verify with Web Crypto's HMAC-SHA256.
- **Attachment concurrency** = 4 by default; size cap default 40MB total payload.
- **Auto opt-out** writes via a `optOutCallback(userId, channel, notificationId?)` so we don't reach into the notify D1 directly — keeps adapter testable.

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/notify-email/package.json` etc. | Manifest + build/test config | New |
| `packages/notify-email/src/index.ts` | Public exports | New |
| `packages/notify-email/src/adapter.ts` | `emailAdapter()` + send | New |
| `packages/notify-email/src/render.ts` | React Email + plain-text fallback | New |
| `packages/notify-email/src/webhook.ts` | parseWebhook + Svix verifySignature | New |
| `packages/notify-email/src/attachments.ts` | R2 fetch + concurrency + size cap | New |
| `packages/notify-email/src/errors.ts` | AttachmentTooLargeError, FromDomainError | New |
| `packages/notify-email/tests/render.test.ts` | render + html→text | New |
| `packages/notify-email/tests/webhook.test.ts` | parser + signature verify + replay window | New |
| `packages/notify-email/tests/attachments.test.ts` | size cap + concurrency | New |
| `packages/notify-email/tests/adapter.test.ts` | end-to-end with mocked Resend `fetch` + R2 | New |
| `packages/notify-email/README.md` | Docs | New |
| `.changeset/feat-notify-email-init.md` | `@workkit/notify-email@0.1.0` | New |

## Tasks (TDD red→green)

1. scaffold
2. impl:errors
3. test:render → impl:render
4. test:attachments → impl:attachments
5. test:webhook → impl:webhook
6. test:adapter → impl:adapter
7. wire src/index.ts + README
8. lint + typecheck + scoped tests
9. maina verify
10. changeset
11. maina commit + push + PR
12. request review

## Failure Modes

- **Resend rejects from-domain** (4xx) → return `status:'failed'` with the provider error string. Caller chooses retry policy.
- **Resend 429** → return `status:'failed'` with the rate-limit error; queue retries.
- **Attachment R2 fetch fails** → fail-fast with the underlying error message (don't silently send incomplete email).
- **Webhook signature mismatch** → throw at adapter; the caller's `webhookHandler` returns 401.
- **HTML render throws** → bubble; caller sees the trace in `error` field of the `failed` row.
- **Plain-text fallback empty** → use `[no text content]` placeholder (RFC 5322 doesn't allow empty text body).

## Testing Strategy

- Unit tests with hand-rolled `fetch` mock + R2 mock.
- React Email render tested with a tiny inline component (no fixture file required) so we don't take a hard test-time dep on real React templates.
- Webhook signature verified against a known good `secret` + payload pair.


## Wiki Context

Auto-populated; no edits.
