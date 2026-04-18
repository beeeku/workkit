# Feature: Cloudflare send_email as default email transport

Tracking issue: [#52](https://github.com/beeeku/workkit/issues/52)

## Problem Statement

`@workkit/notify`'s email adapter is hardcoded to Resend — `packages/notify/src/adapters/email/adapter.ts` POSTs to `api.resend.com/emails` via `fetch`. This forces every workkit user to sign up for an external service, manage a `RESEND_API_KEY` secret, and take on a runtime HTTP dependency, even though Cloudflare now ships a native `send_email` binding (transactional email beta) that covers the transactional-email path with zero config.

The email adapter also stands out as the only notify adapter that **isn't** provider-pluggable. WhatsApp already ships `metaWaProvider` / `twilioWaProvider` / `gupshupWaProvider` behind a `WaProvider` interface (`packages/notify/src/adapters/whatsapp/provider.ts:65`). Email should match that shape.

Who experiences the gap: anyone deploying workkit on Cloudflare for transactional email — their default path today is "pick a third-party provider," not "use the platform primitive."

If we don't solve this: workkit stays mis-positioned against its own thesis ("Worker-native toolkit"), and each new email provider added later (SES, Postmark) requires re-inventing the adapter.

## Target User

- **Primary**: workkit consumers building notification flows on Cloudflare Workers who want zero-config transactional email.
- **Secondary**: contributors adding new email providers (SES, Postmark, Mailgun) — they get a stable interface instead of forking the adapter.

## User Stories

- As a workkit user, I want the email adapter to work with just the `[[send_email]]` binding so that I don't need a third-party account to send transactional mail.
- As a workkit user on Resend, I want a one-line migration so that bumping to the new adapter doesn't force me off Resend.
- As a contributor, I want the email adapter to match the WhatsApp provider shape so that adding SES / Postmark is a single-file addition.
- As a test author, I want `createMockSendEmail` exported from `@workkit/testing` so that I don't reach into another package's private test helpers.

## Success Criteria

Every item is testable.

- [ ] `emailAdapter({ provider: cloudflareEmailProvider({ binding, from }) })` sends via `@workkit/mail`'s `mail()` with no additional setup.
- [ ] `emailAdapter({ provider: resendEmailProvider({ apiKey, from }) })` preserves 100% of current Resend adapter behavior (regression suite unchanged).
- [ ] Calling `emailAdapter({ provider })` without a `provider` arg throws at construction.
- [ ] `EmailProvider` conforms structurally to the same shape as `WaProvider` minus `handleVerificationChallenge`.
- [ ] `@workkit/testing` exports `createMockSendEmail` and `createMockForwardableEmail`.
- [ ] `@workkit/mail`'s private `tests/helpers/mock-email.ts` is removed; mail tests import from testing.
- [ ] `WebhookSignatureError` message is templated by provider name; no literal `"Resend"` in the error path once a non-Resend provider exists.
- [ ] CF provider's `send` catches `DeliveryError` / `InvalidAddressError` from `@workkit/mail` and returns `{status: "failed", error}` — never throws.
- [ ] `@workkit/mail` is an optional peerDependency of `@workkit/notify` — installing notify without `@workkit/mail` succeeds and only fails when a user imports `cloudflareEmailProvider`.
- [ ] `bun run constitution:check -- --diff-only` passes.
- [ ] Changesets present for `@workkit/notify` (minor), `@workkit/testing` (minor), `@workkit/mail` (patch).

## Scope

### In Scope

- `EmailProvider` interface in `@workkit/notify/email`.
- `cloudflareEmailProvider` (default) + `resendEmailProvider` (existing logic extracted).
- `emailAdapter({ provider, ... })` — hard break on `{ apiKey, from }`.
- `@workkit/mail` as optional peerDependency on notify.
- `WebhookSignatureError` message templated by provider.
- `createMockSendEmail` / `createMockForwardableEmail` promoted to `@workkit/testing`.
- `@workkit/mail` tests refactored to consume from testing.
- Docs: notify/email README updated; CF as default example; Resend as alternative.
- Changesets for all three packages.

### Out of Scope (follow-up issues already filed)

- DSN bounce synthesis on Cloudflare transport — **#53** (`parseBounceDSN`) + **#54** (`createBounceRoute`).
- Preserving retry strategy through `AdapterSendResult` — **#55**.
- Docs positioning pass (mail vs notify) — **#56**.
- SES / Postmark provider stubs — **#57**.
- Complaint feedback-loop (FBL) handling on any provider.
- Idempotency keys on send (CF MTA handles retry internally).

## Design Decisions

### D1. Provider abstraction lives in `@workkit/notify`, not `@workkit/mail`

**Decision**: The `EmailProvider` interface lives in notify. `@workkit/mail` stays focused on CF primitives.

**Alternatives considered**:
- *Transport interface in `@workkit/mail`* — rejected. Creates bidirectional coupling: mail would own the "how to ship bytes" abstraction, but notify owns the webhook/event shape. Two owners of one interface.
- *Transport interface in a new `@workkit/transport` package* — rejected. Premature; only one consumer (notify's email adapter) needs it.

**Why**: Providers differ on exactly the axes notify cares about (signatures, webhooks, bounce events). Mail stays the thin CF primitive.

### D2. Cloudflare is the default, Resend is the first-class alternative

**Decision**: All docs/examples use `cloudflareEmailProvider` by default.

**Alternatives**: keep Resend as default. Rejected — contradicts workkit's Worker-native positioning.

**Tradeoff**: CF binding has no delivery webhooks → `autoOptOut` is a documented no-op on CF. Accepted for v1; follow-up **#54** closes the gap via inbound DSN routing.

### D3. Hard break on `emailAdapter({ apiKey, from })` shape

**Decision**: Pre-1.0 break. Migration is a 1-line diff.

**Alternatives**:
- *Soft overload* (accept both shapes) — rejected. Backwards-compat shims violate project convention; notify is pre-1.0 and can break cleanly.
- *Deprecation + soft removal* — rejected. Same reasoning; users get one hop, not two.

### D4. `@workkit/mail` as optional peerDependency, not hard dependency

**Decision**: Follow the `@react-email/render` precedent. Users who don't use `cloudflareEmailProvider` don't pay.

**Why**: Constitution Rule 1 (zero runtime overhead). Adding a mandatory dep for a feature you might not use compounds badly across consumers.

### D5. `createMockSendEmail` promoted to `@workkit/testing`

**Decision**: Move the private helper to testing as a first-class export.

**Why**: Constitution Rule 3 (every package wires `@workkit/testing`). Without this, every consumer writing email tests either reaches into mail's private helpers or reinvents the mock. Pattern already exists for KV / D1 / R2 / Queue / DO.

### D6. CF provider never throws; catches mail errors and converts

**Decision**: CF provider's `send` returns `AdapterSendResult` and never throws — matches Resend provider's existing contract.

**Why**: Uniform provider surface. The `AdapterSendResult.error` losing retry metadata is a pre-existing gap; tracked separately in **#55**, not fixed in this ticket (would balloon scope).

### D7. `WebhookSignatureError` takes a provider arg

**Decision**: Constructor takes `provider: "resend" | "cloudflare"`; message templated.

**Why**: Today's message literally says `"Resend webhook signature verification failed"` (`errors.ts:21`). Becomes wrong the moment a non-Resend provider exists.

## Open Questions

All resolved during brainstorming. None blocking implementation.

- ~~Should the CF provider synthesize bounce webhooks from inbound DSN parsing?~~ No — split to **#53** + **#54**. Keeps v1 zero-config.
- ~~Hard break or soft overload on `emailAdapter` shape?~~ Hard break (D3).
- ~~Where does provider abstraction live?~~ In notify (D1).
- ~~Hard dep or optional peer for `@workkit/mail`?~~ Optional peer (D4).
- ~~Promote test mocks in this ticket or a prerequisite?~~ This ticket (user confirmed).
