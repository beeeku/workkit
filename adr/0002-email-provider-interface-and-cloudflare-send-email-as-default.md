# 0002. EmailProvider interface and Cloudflare send_email as default

Date: 2026-04-18

Tracking issue: [#52](https://github.com/beeeku/workkit/issues/52)
Feature: `.maina/features/009-cf-email-default/`

## Status

Proposed

## Context

`@workkit/notify`'s email adapter (`packages/notify/src/adapters/email/adapter.ts`) is hardcoded to Resend — it POSTs to `api.resend.com/emails` via `fetch` and bakes Resend's webhook format (Svix signatures) into its validation path. The adapter is the only notify channel that is **not** provider-pluggable; whatsapp already ships `metaWaProvider` / `twilioWaProvider` / `gupshupWaProvider` behind a `WaProvider` interface (`packages/notify/src/adapters/whatsapp/provider.ts:65`).

Meanwhile, Cloudflare has released transactional email (beta) via the `send_email` binding. `@workkit/mail` already wraps this binding and exposes a typed `mail(binding).send(...)` API. But `@workkit/notify` — the layer users actually reach for in multi-channel flows — ignores the platform primitive in favor of an external HTTP provider.

Two things push us to act now:

1. **Positioning drift.** workkit is marketed as a Worker-native toolkit; the default email path should be the platform primitive, not a third-party service.
2. **Architectural inconsistency.** Adding a second email provider (even a native one) today would require forking the adapter. Whatsapp solved this with a provider interface; email should match.

This ADR records the design decisions for introducing that interface and making Cloudflare the default.

## Decision

Introduce `EmailProvider` in `@workkit/notify/email`, mirroring `WaProvider`. Ship two providers — `cloudflareEmailProvider` (default) and `resendEmailProvider` (existing logic extracted). Refactor `emailAdapter` to accept `{ provider, ... }` and delegate send / webhook-parse / signature-verify to the provider. Break the old `{ apiKey, from }` shape (pre-1.0). Promote the private `createMockSendEmail` / `createMockForwardableEmail` helpers to `@workkit/testing` so all downstream test code has a shared mock surface.

Seven design decisions stand behind this:

### D1. The provider abstraction lives in `@workkit/notify`, not `@workkit/mail`

`@workkit/mail` stays a thin wrapper around CF primitives. `@workkit/notify` owns the provider interface because providers differ on exactly the axes notify cares about — webhook payload shapes, signature algorithms, bounce/complaint event taxonomies. Putting the interface in mail would create bidirectional coupling (mail owns "how to ship bytes," notify owns "how to parse events") with two owners of one concept.

**Rejected alternatives**:
- *Transport interface in `@workkit/mail`*: see above — wrong ownership.
- *New `@workkit/transport` package*: premature; only one consumer (notify/email).

### D2. Cloudflare is the default; Resend is the first-class alternative

All docs, README examples, and quick-starts default to `cloudflareEmailProvider`. Resend moves to an "Alternative providers" section. This aligns workkit with its own positioning: zero-config on the platform, opt-in for advanced analytics / inbox placement.

**Tradeoff**: CF `send_email` has no delivery webhooks. `autoOptOut` (bounce + complaint → opt-out) is a Resend-only feature for v1. Follow-up #54 closes the gap via inbound DSN parsing (depends on #53 `parseBounceDSN`).

### D3. Hard break on `emailAdapter({ apiKey, from })`

`@workkit/notify` is pre-1.0 (`0.1.0`). Migration is a 1-line diff:

```diff
- emailAdapter({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com" })
+ emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com" }) })
```

**Rejected alternatives**:
- *Soft overload* (accept both shapes): violates project convention against backwards-compat shims.
- *Deprecation cycle*: two hops for users instead of one, with no real payoff pre-1.0.

### D4. `@workkit/mail` is an **optional** peerDependency of `@workkit/notify`

Follows the existing `@react-email/render` precedent. Only users who import `cloudflareEmailProvider` pay the `@workkit/mail` install cost. Preserves Constitution Rule 1 (zero runtime overhead for uninvolved consumers).

```json
"peerDependencies": {
  "@react-email/render": ">=1.0.0",
  "@workkit/mail": "workspace:*"
},
"peerDependenciesMeta": {
  "@react-email/render": { "optional": true },
  "@workkit/mail": { "optional": true }
}
```

### D5. `createMockSendEmail` + `createMockForwardableEmail` promoted to `@workkit/testing`

Currently these live as private test helpers at `packages/mail/tests/helpers/mock-email.ts`. Promoting them to `@workkit/testing` satisfies Constitution Rule 3 (every package wires testing) for all downstream consumers writing email tests, and matches the `createMockKV` / `createMockD1` / `createMockR2` / `createMockQueue` pattern.

### D6. The Cloudflare provider never throws; it catches mail errors and converts

Mail's `mail().send()` throws `DeliveryError` (retryable) or `InvalidAddressError` (terminal). The Resend provider's existing `send` returns `{status: "failed", error: string}` and never throws. For a uniform provider contract, CF provider catches and converts:

```ts
try {
  await mail(binding, { defaultFrom: from }).send(args);
  return { status: "sent", providerId: ... };
} catch (err) {
  return { status: "failed", error: err instanceof Error ? err.message : String(err) };
}
```

The fact that `AdapterSendResult` flattens retry metadata (`retryable`, `defaultRetryStrategy`) into a string is a **pre-existing gap across all notify adapters** (email/Resend, whatsapp, inapp). Fixing it would balloon this ticket's scope and requires its own ADR. Tracked separately in #55.

### D7. `WebhookSignatureError` message is templated by provider

Today's error literally says `"Resend webhook signature verification failed"` (`packages/notify/src/adapters/email/errors.ts:21`). Once a non-Resend provider exists this is wrong. Constructor takes `provider: "resend" | "cloudflare"` and templates the message. CF provider does not verify signatures (no webhooks) so this only affects the Resend call site today, but the signature is future-proofed for SES / Postmark (#57).

## Consequences

### Positive

- **Worker-native onboarding.** New users deploy transactional email with zero external accounts — just a `[[send_email]]` binding in `wrangler.toml`.
- **Consistency across notify channels.** Email now matches the whatsapp provider shape; contributors get one mental model instead of two.
- **Adding providers is a one-file change.** SES / Postmark stubs (#57) become trivial; community contributions are self-contained.
- **Test ergonomics improve everywhere.** Shared mocks in `@workkit/testing` remove per-package duplication and lower the bar for downstream consumers to write email tests.
- **Cleaner error taxonomy.** `WebhookSignatureError` stops lying about which provider it's verifying.
- **Zero-cost for Resend-only users.** Optional peerDep means they don't pay for `@workkit/mail`.

### Negative

- **Breaking API change.** Every existing `emailAdapter({ apiKey, from })` call site must migrate. The migration is mechanical (1-line diff) and documented in the changeset, but it is still a break.
- **Feature asymmetry between providers.** CF provider's `autoOptOut` is a no-op until #53 + #54 land; Resend provider supports it fully. Users need to understand this tradeoff when choosing a default. Mitigated by explicit docs.
- **Indirect coupling: notify optionally depends on mail.** New dependency edge in the package graph (`notify → mail`), even if optional. Documented and matches constitution Rule 5.
- **CF provider silently swallows `DeliveryError` retry metadata.** Acknowledged in D6; tracked as #55. Users on CF see failures as `{status: "failed", error: string}` and must rely on queue-level retry policy, not the mail error's own `defaultRetryStrategy`.

### Neutral

- **Test files reshuffle.** Existing `adapter.test.ts` splits into a provider-agnostic contract suite + per-provider suites. Same coverage, different file layout.
- **Docs rewrite for notify/email README.** Aesthetic only; no new user-facing concepts beyond "choose a provider."
- **`@workkit/mail` loses its private test helper.** Replaced by import from `@workkit/testing`; zero behavioral change.

## High-Level Design

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│ User code                                                │
│   emailAdapter({ provider: cloudflareEmailProvider(...)})│
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ @workkit/notify/email/adapter.ts                         │
│   - Cross-cutting: attachments, markUnsubscribable,      │
│     autoOptOut wiring, delivery record integration       │
│   - Delegates: send / parseWebhook / verifySignature     │
└────────┬───────────────────────────┬────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐      ┌─────────────────────────────┐
│ cloudflare.ts   │      │ resend.ts                    │
│ - delegates to  │      │ - fetch → api.resend.com     │
│   @workkit/mail │      │ - Svix signature verify      │
│ - catches mail  │      │ - bounce/complaint webhook   │
│   errors        │      │   parsing                    │
└────────┬────────┘      └──────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ @workkit/mail                   │
│   mail(binding).send(msg)       │
│   → CF SendEmail binding        │
└─────────────────────────────────┘
```

### Component Boundaries

- **`@workkit/notify/email/adapter.ts`** — owns cross-cutting concerns (attachments from R2, `markUnsubscribable` header assembly, auto-opt-out invocation on webhook events). Doesn't know about providers beyond the `EmailProvider` shape.
- **`@workkit/notify/email/providers/*.ts`** — each file owns one provider's wire format, signature algorithm, and webhook parsing. No shared state between providers.
- **`@workkit/notify/email/provider.ts`** — pure type definitions.
- **`@workkit/mail`** — CF primitives (MIME composition, address validation, binding invocation). Unchanged by this ADR except for the test helper migration.
- **`@workkit/testing`** — shared mock surface. Adds two new mocks; no changes to existing mocks.

### Data Flow

**Send path**:
1. User calls `notify.send(...)` (or direct `dispatch(...)`).
2. Dispatch pipeline resolves user, checks prefs/opt-out/quiet-hours, looks up the email template.
3. Pipeline calls `adapter.send(args)`.
4. Adapter: loads attachments from R2 if template requires them; assembles `markUnsubscribable` headers if notification id matches.
5. Adapter calls `provider.send(args)`.
6. Provider (CF): delegates to `mail(binding).send({ from, to, subject, html, text, attachments, headers })`. Catches `DeliveryError` / `InvalidAddressError`, returns `AdapterSendResult`.
7. Provider (Resend): POSTs to `api.resend.com/emails` with structured body. Returns `AdapterSendResult`.
8. Adapter writes delivery record (idempotency key, status, providerId).

**Webhook path** (Resend only in v1):
1. User's webhook route calls `webhookHandler({ channel: "email", ... })`.
2. Handler calls `adapter.verifySignature?(req, secret)` → delegates to `provider.verifySignature(...)`.
3. Handler calls `adapter.parseWebhook?(req)` → delegates to `provider.parseWebhook(...)`.
4. Handler updates delivery records idempotently; fires `autoOptOut` hook on hard-bounce / complaint.
5. CF provider: both methods undefined → webhook handler returns 501 / no-op for that channel (user shouldn't be wiring this for CF transport).

### External Dependencies

- `@workkit/mail` — optional peer, required only for CF provider path.
- `@workkit/errors` — existing hard dep, unchanged.
- `@react-email/render` — existing optional peer, unchanged.
- Cloudflare `SendEmail` / `ForwardableEmailMessage` types — platform types, already in mail's surface.

## Low-Level Design

### Interfaces & Types

```ts
// packages/notify/src/adapters/email/provider.ts
import type { AdapterSendResult, WebhookEvent } from "../../types";

export interface EmailProviderSendArgs {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly EmailAttachmentWire[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly replyTo?: string | readonly string[];
  readonly notificationId: string;
  readonly deliveryId: string;
}

export interface EmailAttachmentWire {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface EmailProvider {
  readonly name: "cloudflare" | "resend";
  send(args: EmailProviderSendArgs): Promise<AdapterSendResult>;
  parseWebhook?(req: Request): Promise<WebhookEvent[]>;
  verifySignature?(req: Request, secret: string): Promise<boolean>;
}
```

### Function Signatures

```ts
// packages/notify/src/adapters/email/providers/cloudflare.ts
export interface CloudflareEmailProviderOptions {
  readonly binding: SendEmail;
  readonly from: string;
  readonly replyTo?: string | readonly string[];
}
export function cloudflareEmailProvider(opts: CloudflareEmailProviderOptions): EmailProvider;

// packages/notify/src/adapters/email/providers/resend.ts
export interface ResendEmailProviderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly apiUrl?: string;
  readonly webhook?: { maxAgeMs?: number };
}
export function resendEmailProvider(opts: ResendEmailProviderOptions): EmailProvider;

// packages/notify/src/adapters/email/adapter.ts
export interface EmailAdapterOptions {
  readonly provider: EmailProvider;
  readonly bucket?: R2BucketLike;
  readonly attachments?: AttachmentLoadOptions;
  readonly autoOptOut?: { enabled?: boolean; hook: EmailOptOutHook };
  readonly markUnsubscribable?: ReadonlyArray<string>;
}
export function emailAdapter(opts: EmailAdapterOptions): Adapter<EmailPayload>;

// packages/testing/src/email.ts (promoted)
export function createMockSendEmail(): MockSendEmail;
export function createMockForwardableEmail(opts?: MockEmailOptions): MockForwardableEmail;
```

### DB Schema Changes

None. Delivery record schema unchanged.

### Sequence of Operations

```
User                Adapter              Provider(CF)         mail()          Binding
  │                    │                      │                  │                │
  │ adapter.send(args) │                      │                  │                │
  ├───────────────────▶│                      │                  │                │
  │                    │ loadAttachments(R2)  │                  │                │
  │                    │◀────────bytes────────┤                  │                │
  │                    │                      │                  │                │
  │                    │ provider.send(args)  │                  │                │
  │                    ├─────────────────────▶│                  │                │
  │                    │                      │ mail(binding).send(composed)     │
  │                    │                      ├─────────────────▶│                │
  │                    │                      │                  │ binding.send   │
  │                    │                      │                  ├───────────────▶│
  │                    │                      │                  │◀────ok─────────┤
  │                    │                      │◀────messageId────┤                │
  │                    │◀────{sent, id}───────┤                  │                │
  │                    │                      │                  │                │
  │                    │ insertDelivery(…)    │                  │                │
  │◀──AdapterSendResult┤                      │                  │                │
```

Failure paths (CF provider catching mail errors):

```
provider.send(args)
  ├─ try { mail(binding).send(composed) }
  │    └─ throws DeliveryError → return { status: "failed", error: err.message }
  │    └─ throws InvalidAddressError → return { status: "failed", error: err.message }
  │    └─ throws unknown → return { status: "failed", error: String(err) }
  └─ success → return { status: "sent", providerId: messageId }
```

### Error Handling

| Source | Mail throws | CF provider returns | Resend provider returns |
|---|---|---|---|
| Invalid `from` | `InvalidAddressError` | `{status: "failed", error}` | (validated in ctor via `FromDomainError`) |
| Invalid `to` | `InvalidAddressError` | `{status: "failed", error}` | Resend API rejects; `{status: "failed", error}` |
| Binding rejects | `DeliveryError` (retryable) | `{status: "failed", error}` | N/A |
| Resend 4xx/5xx | N/A | N/A | `{status: "failed", error}` |
| Network failure | `DeliveryError` (retryable) | `{status: "failed", error}` | `{status: "failed", error}` |
| Missing `provider` | N/A | N/A | Adapter ctor throws `ConfigError` |

**Note on retry metadata**: The `AdapterSendResult.error` field is a flat string; `DeliveryError.retryable = true` does not propagate to the pipeline. This is a pre-existing gap across all notify adapters, not introduced by this ADR. Tracked in #55.

### Edge Cases

- **No `@workkit/mail` installed + user imports `cloudflareEmailProvider`** → standard peerDep missing-module error at import time. Documented in CF provider JSDoc.
- **CF provider given a `SendEmail` binding that's null/undefined** → `@workkit/mail`'s `mail()` throws `BindingNotFoundError` from constructor. Wraps to `{status: "failed", error}` on first send.
- **Resend provider called with missing `apiKey`** → `ConfigError` at provider construction (existing behavior).
- **`emailAdapter({})` with no provider** → throws `ConfigError` at adapter construction (new behavior).
- **Provider's `parseWebhook` / `verifySignature` missing but webhook arrives** → `webhookHandler` already guards for this (existing); returns a clear 501-style response. CF provider path.
- **Attachment flow + CF provider** — attachments loaded by adapter from R2 as Uint8Array, passed to CF provider, which converts to mail's `MailAttachment` shape (`content: ArrayBuffer | Uint8Array | string`). No base64 encoding needed for CF (unlike Resend).
- **`markUnsubscribable` + CF provider** — headers assembled by adapter, passed through to provider via `EmailProviderSendArgs.headers`. CF provider forwards to mail's `composeMessage({ headers })`. CF's MTA reliably ships `X-*` headers; `List-Unsubscribe*` may or may not survive (to be documented).
