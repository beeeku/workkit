---
"@workkit/notify": minor
"@workkit/testing": minor
"@workkit/mail": patch
---

**Cloudflare `send_email` is now the default email transport.** `@workkit/notify`'s email adapter is refactored to be provider-pluggable (matching the WhatsApp provider pattern), with `cloudflareEmailProvider` as the default and `resendEmailProvider` as the first-class alternative. Closes #52.

**Breaking — `emailAdapter` options shape (pre-1.0).** The `{ apiKey, from, ... }` shape is removed. Callers must explicitly pass a provider:

```diff
- emailAdapter({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } })
+ emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } }) })
```

Or switch to the new zero-config default:

```ts
emailAdapter({ provider: cloudflareEmailProvider({ binding: env.SEND_EMAIL, from: "noreply@x.com" }) })
```

`autoOptOut` now lives on the Resend provider (where webhook events originate); the Cloudflare provider has no delivery webhooks and no `autoOptOut` — bounce synthesis from inbound DSN is tracked in the roadmap (#53 / #54).

**`@workkit/mail` added as optional peerDependency on `@workkit/notify`.** Only users of `cloudflareEmailProvider` install it.

**`@workkit/testing` gains `createMockSendEmail` and `createMockForwardableEmail`** — promoted from a private helper in `@workkit/mail`. Matches the `createMockKV` / `createMockD1` / `createMockR2` pattern. `@workkit/mail` tests migrated to consume these.

**`WebhookSignatureError`** takes a `provider: "resend" | "cloudflare"` arg; error messages now indicate which provider failed verification.

Follow-ups filed: #53 (parseBounceDSN), #54 (createBounceRoute), #55 (retry strategy in AdapterSendResult), #56 (docs positioning), #57 (SES/Postmark provider stubs).
