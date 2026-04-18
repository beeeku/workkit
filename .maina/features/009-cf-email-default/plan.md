# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

Tracking issue: [#52](https://github.com/beeeku/workkit/issues/52)

## Architecture

**Pattern**: Provider-pluggable adapter, mirroring `WaProvider` (`packages/notify/src/adapters/whatsapp/provider.ts:65`).

**Integration points**:
- `@workkit/notify/email` gains a `provider.ts` module + two provider factories.
- `@workkit/notify/email/adapter.ts` — refactored to accept `{ provider }` instead of `{ apiKey, from, ... }`. Delegates `send` / `parseWebhook` / `verifySignature` through to the provider.
- `@workkit/mail` is imported only inside `cloudflareEmailProvider` — scoped so tree-shaking keeps it out for Resend-only users.
- `@workkit/testing` gains two new mock factories; `@workkit/mail` tests migrate to consume them.

**Dependency direction**: `notify → mail → (cf types)`. One-way. No reverse edges introduced.

## Key Technical Decisions

See spec.md §Design Decisions for rationale. Summary:

| Decision | Choice |
|---|---|
| Where does the provider interface live? | `@workkit/notify` (D1) |
| Default provider | Cloudflare (D2) |
| API break on `emailAdapter` | Hard break (D3) |
| `@workkit/mail` dependency shape | Optional peerDependency (D4) |
| Mock promotion | In this ticket (D5) |
| CF provider error handling | Catch + convert, never throw (D6) |
| Webhook error message | Templated by provider (D7) |

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/notify/src/adapters/email/provider.ts` | `EmailProvider` interface + shared provider types | **New** |
| `packages/notify/src/adapters/email/providers/cloudflare.ts` | `cloudflareEmailProvider({ binding, from, replyTo? })` | **New** |
| `packages/notify/src/adapters/email/providers/resend.ts` | `resendEmailProvider({ apiKey, from, apiUrl?, webhook? })` — logic extracted from `adapter.ts` | **New** |
| `packages/notify/src/adapters/email/adapter.ts` | Refactor: `emailAdapter({ provider, bucket?, attachments?, autoOptOut?, markUnsubscribable? })`; delegate send/webhook/signature to provider | Modified |
| `packages/notify/src/adapters/email/errors.ts` | `WebhookSignatureError` takes `provider` arg | Modified |
| `packages/notify/src/adapters/email/webhook.ts` | Update signature-verification call site to pass `provider` to `WebhookSignatureError` | Modified |
| `packages/notify/src/adapters/email/index.ts` | Export `EmailProvider`, `cloudflareEmailProvider`, `resendEmailProvider` | Modified |
| `packages/notify/package.json` | Add `@workkit/mail` to `peerDependencies` (optional); add `cloudflare-email` keyword | Modified |
| `packages/notify/README.md` | CF as default example; Resend as alternative | Modified |
| `packages/testing/src/email.ts` | `createMockSendEmail` + `createMockForwardableEmail` | **New** |
| `packages/testing/src/index.ts` | Export the two new mocks | Modified |
| `packages/mail/tests/helpers/mock-email.ts` | **Delete** — migrated to testing | Removed |
| `packages/mail/tests/sender.test.ts` | Update import: `@workkit/testing` | Modified |
| `packages/notify/tests/adapters/email/adapter.test.ts` | Rewrite setup to use `{ provider }`; split into provider-agnostic + Resend-specific + CF-specific | Modified |
| `packages/notify/tests/adapters/email/provider.test.ts` | Contract suite — both providers pass | **New** |
| `packages/notify/tests/adapters/email/providers/cloudflare.test.ts` | CF provider unit tests (delegates to mail, error conversion) | **New** |
| `packages/notify/tests/adapters/email/providers/resend.test.ts` | Resend provider unit tests (lifted from current adapter.test) | **New** |
| `.changeset/cf-email-default.md` | Minor bump for notify + testing; patch for mail | **New** |

## Tasks

TDD — every implementation task has a preceding test task. Detailed sequencing in tasks.md.

High-level phases:

1. **Testing package mocks** (lowest blast radius, unblocks mail + notify tests).
2. **Mail test migration** (proves the mock promotion end-to-end).
3. **Provider interface + Resend provider extraction** (no behavior change — pure refactor with regression tests).
4. **Cloudflare provider** (new surface, depends on mail + testing).
5. **Adapter refactor** (breaking API change, depends on both providers).
6. **Error message templating** (small, last).
7. **Docs + changeset** (tail).

## Failure Modes

| Failure | How we handle it |
|---|---|
| User forgets `@workkit/mail` peerDep when importing `cloudflareEmailProvider` | Runtime import error — standard peerDep UX. Document in the CF provider JSDoc + README. |
| `binding.send` throws (mail's `DeliveryError`) | CF provider catches, returns `{status: "failed", error: err.message}`. |
| Invalid `from` address reaches CF provider | Mail throws `InvalidAddressError` → CF provider catches → returns `{status: "failed", error}`. |
| User passes `emailAdapter({})` without a `provider` | Constructor throws `ConfigError` at import time (fail fast). |
| User migrating from `{ apiKey, from }` hits runtime TypeError | Changelog has the 1-line diff; error message on the old-shape call points them at the migration note. |
| Resend webhook signature fails with the templated message | Error message includes provider name so users grep-find correctly. |
| Build pipeline can't resolve `@workkit/mail` | Workspace declaration `workspace:*` handles local; published notify resolves via the optional peer. |

## Testing Strategy

**Unit tests** for each provider — both pass a shared contract suite.

**Contract suite** (runs against both providers):
- `provider.name` is defined.
- `send({ from, to, subject, html, text })` returns `AdapterSendResult`.
- Provider never throws from `send`.
- Optional `parseWebhook` / `verifySignature` either both present or both absent.

**Cloudflare-specific**:
- `send` invokes `@workkit/mail`'s `mail()` exactly once with the composed args.
- Catches `DeliveryError` → returns `{status: "failed", ...}`.
- Catches `InvalidAddressError` → returns `{status: "failed", ...}`.
- `parseWebhook` / `verifySignature` are `undefined`.

**Resend-specific regression**:
- Existing `adapter.test.ts` + `webhook.test.ts` pass without behavior modifications (only setup changes to use `resendEmailProvider`).

**`@workkit/testing`**:
- `createMockSendEmail` records sent payloads; provides `_sent` inspection.
- `createMockForwardableEmail` constructs a valid MIME ReadableStream consumable by mail's parser.

**Integration**:
- `emailAdapter({ provider })` end-to-end with each provider via dispatch pipeline.
- `emailAdapter({})` throws at construction.

**Constitution gate**:
- `bun run constitution:check -- --diff-only` passes.
- Changeset present; `console.log`-free; single index per package.

Mocks needed: `createMockSendEmail` (from testing), `fetch` mock for Resend (existing), `D1` mock (existing for dispatch).

## Wiki Context

### Related Modules

- **src** (69 entities) — `modules/src.md`
- **cluster-17** (16 entities) — `modules/cluster-17.md`
- **cluster-43** (5 entities) — `modules/cluster-43.md`
- **cluster-35** (3 entities) — `modules/cluster-35.md`
- **cluster-129** (2 entities) — `modules/cluster-129.md`
- **cluster-110** (2 entities) — `modules/cluster-110.md`
- **cluster-134** (2 entities) — `modules/cluster-134.md`

### Suggestions

- Module 'src' already has 69 entities — consider extending it
- Module 'cluster-17' already has 16 entities — consider extending it
