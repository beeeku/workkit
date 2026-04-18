# Task Breakdown

Tracking issue: [#52](https://github.com/beeeku/workkit/issues/52)

Each task is completable in one commit. Test tasks precede implementation tasks (TDD).

## Tasks

### Phase 1 — Testing package mocks (unblocks mail + notify tests)

- [ ] **T1.1 (test)** — `packages/testing/tests/email.test.ts`: smoke tests for `createMockSendEmail` (records `_sent`) and `createMockForwardableEmail` (produces valid MIME stream).
- [ ] **T1.2 (impl)** — `packages/testing/src/email.ts`: port `createMockSendEmail` + `createMockForwardableEmail` from `packages/mail/tests/helpers/mock-email.ts` verbatim. Export from `packages/testing/src/index.ts`.

### Phase 2 — Mail test migration

- [ ] **T2.1 (refactor)** — `packages/mail/tests/sender.test.ts`: replace imports from the private helper with imports from `@workkit/testing`. Tests still pass.
- [ ] **T2.2 (cleanup)** — Delete `packages/mail/tests/helpers/mock-email.ts`.
- [ ] **T2.3 (devdep)** — Confirm `@workkit/mail`'s `devDependencies` has `@workkit/testing` (constitution Rule 3). Add if missing.

### Phase 3 — Provider interface + Resend extraction

- [ ] **T3.1 (test)** — `packages/notify/tests/adapters/email/provider.test.ts`: write the contract suite against a dummy provider (no impl yet — establishes the interface shape).
- [ ] **T3.2 (impl)** — `packages/notify/src/adapters/email/provider.ts`: define `EmailProvider` interface + shared types (`EmailProviderSendArgs` derived from current `ResendSendBody`-equivalent).
- [ ] **T3.3 (test)** — `packages/notify/tests/adapters/email/providers/resend.test.ts`: lift relevant cases from current `adapter.test.ts` — `send` happy path, `send` error paths, `parseWebhook`, `verifySignature`, auto-opt-out.
- [ ] **T3.4 (impl)** — `packages/notify/src/adapters/email/providers/resend.ts`: extract existing Resend logic (from `adapter.ts`) behind `resendEmailProvider({ apiKey, from, apiUrl?, webhook? })`. `name: "resend"`. Passes the contract suite.
- [ ] **T3.5 (lint)** — No Resend-specific code remains in `adapter.ts` after this phase.

### Phase 4 — Cloudflare provider

- [ ] **T4.1 (test)** — `packages/notify/tests/adapters/email/providers/cloudflare.test.ts`: test that `send` invokes `@workkit/mail`'s `mail()` once with composed args; catches `DeliveryError` → `{status: "failed"}`; catches `InvalidAddressError` → `{status: "failed"}`; `parseWebhook` + `verifySignature` are `undefined`; contract suite passes.
- [ ] **T4.2 (impl)** — `packages/notify/src/adapters/email/providers/cloudflare.ts`: `cloudflareEmailProvider({ binding, from, replyTo? })` — delegates to `mail(binding)` and converts mail's errors. `name: "cloudflare"`.
- [ ] **T4.3 (peerdep)** — `packages/notify/package.json`: add `@workkit/mail` to `peerDependencies` with `peerDependenciesMeta.optional: true`.

### Phase 5 — Adapter refactor

- [ ] **T5.1 (test)** — Rewrite `packages/notify/tests/adapters/email/adapter.test.ts` around `emailAdapter({ provider })`. Tests: missing `provider` throws; adapter delegates `send` to provider; adapter delegates `parseWebhook` / `verifySignature` to provider when defined; attachments flow unchanged; `markUnsubscribable` header logic unchanged.
- [ ] **T5.2 (impl)** — Refactor `packages/notify/src/adapters/email/adapter.ts`: new `EmailAdapterOptions` shape `{ provider, bucket?, attachments?, autoOptOut?, markUnsubscribable? }`. Delegate lifecycle methods to provider. Keep attachment loading + `markUnsubscribable` header assembly in the adapter (cross-cutting, not provider-specific).
- [ ] **T5.3 (export)** — `packages/notify/src/adapters/email/index.ts`: export `EmailProvider`, `cloudflareEmailProvider`, `resendEmailProvider`. Remove exports that relied on old shape.

### Phase 6 — Error message templating

- [ ] **T6.1 (test)** — `packages/notify/tests/adapters/email/errors.test.ts`: `WebhookSignatureError` message includes the provider name for both providers.
- [ ] **T6.2 (impl)** — `packages/notify/src/adapters/email/errors.ts`: `WebhookSignatureError` constructor takes `provider: "resend" | "cloudflare"`.
- [ ] **T6.3 (callsite)** — `packages/notify/src/adapters/email/webhook.ts` (and any other Resend-specific call sites): pass `"resend"` to the error.

### Phase 7 — Docs + changeset

- [ ] **T7.1 (docs)** — `packages/notify/README.md`: CF provider as default example; Resend as alternative. Migration snippet at top of "Email adapter" section.
- [ ] **T7.2 (changeset)** — `.changeset/cf-email-default.md`: minor bump for `@workkit/notify` + `@workkit/testing`; patch for `@workkit/mail`. Include the 1-line migration diff in the body.
- [ ] **T7.3 (keywords)** — Add `"cloudflare-email"` to `packages/notify/package.json` keywords.

### Phase 8 — Verification gate

- [ ] **T8.1** — `bun run constitution:check -- --diff-only` passes.
- [ ] **T8.2** — `turbo test` passes across all touched packages.
- [ ] **T8.3** — `turbo typecheck` passes.
- [ ] **T8.4** — `biome check .` passes.
- [ ] **T8.5** — `maina verify` → `maina slop` → `maina review` — all green.

## Dependencies

Critical path:

```
T1.1 → T1.2 ─┬─► T2.1 → T2.2 → T2.3
             └─► T4.1

T3.1 → T3.2 ─┬─► T3.3 → T3.4 → T3.5
             │
             └─► T4.1 → T4.2 → T4.3 ──┐
                                      ├─► T5.1 → T5.2 → T5.3 → T6.1 → T6.2 → T6.3 → T7.* → T8.*
                                      │
                             T3.5 ────┘
```

In words:
- Testing mocks (Phase 1) unblock both mail migration (Phase 2) and CF provider tests (Phase 4).
- Provider interface (Phase 3) must land before the two provider impls.
- Both providers must exist before the adapter refactor (Phase 5) — so the adapter can exercise them.
- Error templating (Phase 6) follows the adapter refactor because it changes a call-site touched by Phase 5.
- Docs + changeset (Phase 7) come last.
- Phase 8 is the verification gate — nothing merges without it.

## Definition of Done

- [ ] All acceptance criteria from spec.md §Success Criteria met.
- [ ] All tests pass (`turbo test`).
- [ ] Biome clean (`biome check .`).
- [ ] TypeScript compiles (`turbo typecheck`).
- [ ] Constitution check passes (`bun run constitution:check -- --diff-only`).
- [ ] `maina verify` / `maina slop` / `maina review` green.
- [ ] Changesets present: notify (minor), testing (minor), mail (patch).
- [ ] PR links to #52 and references #53 / #54 / #55 / #56 / #57 as follow-ups.
- [ ] CodeRabbit + Copilot review feedback addressed.
