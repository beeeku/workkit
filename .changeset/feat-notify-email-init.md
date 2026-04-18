---
"@workkit/notify-email": minor
---

Add `@workkit/notify-email` — email transport adapter for `@workkit/notify`.
Resend HTTP API + optional React Email rendering. Webhook signature
verification (Svix-format `v1,<base64>` HMAC-SHA256), 5-min replay window,
automatic opt-out on hard bounces and complaints.

- **`emailAdapter({ apiKey, from, replyTo?, bucket?, webhook?, autoOptOut?, disableTrackingFor? })`** —
  returns `Adapter<EmailPayload>` ready to register with `@workkit/notify`.
- **`renderEmail({ template, props?, text? })`** — string templates render
  as-is; React Email components render via the optional
  `@react-email/render` peer.
- **`htmlToText(html)`** — auto plain-text fallback (strip + decode +
  collapse).
- **`parseResendEvents(rawBody)`** — maps Resend events to
  `@workkit/notify`'s `WebhookEvent`. Complaints surface as `bounced`.
- **`verifyResendSignature(req, secret)`** — Svix-format HMAC-SHA256 with
  configurable replay window.
- **Auto opt-out** on hard bounce + complaint (configurable, default on).
  The hook resolves the email address from the webhook to the caller's
  internal user id.
- **Tracking allowlist** — disable open/click tracking per-notification id.
- **Attachment cap** 40MB; **bounded R2 fetch concurrency** default 4.

Closes #27.
