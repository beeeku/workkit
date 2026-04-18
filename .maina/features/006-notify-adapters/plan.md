# Implementation Plan — @workkit/notify adapters (email + inapp)

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: each adapter lives under `packages/notify/src/adapters/<name>/` with its own `index.ts`. Subpath exports in `packages/notify/package.json`:
  - `./email` → `dist/adapters/email/index.{js,d.ts}`
  - `./inapp` → `dist/adapters/inapp/index.{js,d.ts}`
- **Build**: bunup config gets two extra entries (`adapters/email/index.ts`, `adapters/inapp/index.ts`).
- **Layering** (per adapter):
  - email: `adapter.ts`, `render.ts`, `webhook.ts`, `attachments.ts`, `errors.ts`
  - inapp: `adapter.ts`, `feed.ts`, `sse.ts`, `safe-link.ts`, `forget.ts`, `errors.ts`, `schema.ts`
- **Integration**: both adapters import the `Adapter` shape from notify-core (intra-package import — fine since they live in the same package).

## Key Technical Decisions

- **Subpath exports** require updating `package.json` `exports` map. Each subpath has its own `import` condition pointing to its built artifact.
- **Optional peer deps** declared in `peerDependencies` + `peerDependenciesMeta.optional: true`:
  - `@react-email/render` — used by `./email`'s render path only.
- **TypeScript subpath types** — `dist/adapters/email/index.d.ts` referenced from `exports` `import.types`.
- **bunup multi-entry**: `entry: ["src/index.ts", "src/adapters/email/index.ts", "src/adapters/inapp/index.ts"]`. Verify shared chunks land cleanly.
- **Tests**: live under `packages/notify/tests/adapters/{email,inapp}/`. Vitest already globs `tests/**/*.test.ts`.
- **`safeLink` lives in inapp subpath** (only used there in v1; can be promoted to a shared helper if WhatsApp needs it later).

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/notify/package.json` | Add `./email` + `./inapp` exports, optional peer for react-email | Modified |
| `packages/notify/bunup.config.ts` | Multi-entry config | Modified |
| `packages/notify/src/adapters/email/adapter.ts` | `emailAdapter` + Resend POST | New |
| `packages/notify/src/adapters/email/render.ts` | render + htmlToText | New |
| `packages/notify/src/adapters/email/webhook.ts` | Resend event parser + Svix verify | New |
| `packages/notify/src/adapters/email/attachments.ts` | R2 fetch + concurrency + cap | New |
| `packages/notify/src/adapters/email/errors.ts` | FromDomainError, AttachmentTooLargeError, WebhookSignatureError | New |
| `packages/notify/src/adapters/email/index.ts` | public exports for `./email` subpath | New |
| `packages/notify/src/adapters/inapp/adapter.ts` | `inAppAdapter` (insert + body cap + push to SSE) | New |
| `packages/notify/src/adapters/inapp/feed.ts` | feed/markRead/dismiss/unreadCount + cursor | New |
| `packages/notify/src/adapters/inapp/sse.ts` | SseRegistry + createSseHandler | New |
| `packages/notify/src/adapters/inapp/safe-link.ts` | safeLink scheme allowlist | New |
| `packages/notify/src/adapters/inapp/forget.ts` | forgetInAppUser cascade | New |
| `packages/notify/src/adapters/inapp/schema.ts` | INAPP_MIGRATION_SQL | New |
| `packages/notify/src/adapters/inapp/errors.ts` | BodyTooLongError, UnsafeLinkError | New |
| `packages/notify/src/adapters/inapp/index.ts` | public exports for `./inapp` subpath | New |
| `packages/notify/tests/adapters/email/*.test.ts` | render, attachments, webhook, adapter | New |
| `packages/notify/tests/adapters/inapp/*.test.ts` | feed, sse, safe-link, adapter | New |
| `packages/notify/README.md` | add Adapters section | Modified |
| `.changeset/feat-notify-adapters.md` | `@workkit/notify` minor — adds email + inapp subpaths | New |

## Tasks (TDD)

1. update `package.json` exports + peer deps; update bunup config for multi-entry; verify build still emits the existing `dist/index.js`
2. test:email/render → impl
3. test:email/attachments → impl
4. test:email/webhook → impl
5. test:email/adapter → impl
6. test:inapp/safe-link → impl
7. test:inapp/feed → impl
8. test:inapp/sse → impl
9. test:inapp/adapter → impl + impl:forget
10. wire `src/adapters/email/index.ts` and `src/adapters/inapp/index.ts`
11. update notify README — add subpath usage section
12. lint + typecheck + scoped tests
13. maina verify
14. changeset
15. maina commit + push + PR
16. request review

## Failure Modes

- **Subpath exports misconfigured** → consumers `import "@workkit/notify/email"` fails at install time. Verify by running `bun pack` + a smoke import in a tmp dir before merging.
- **bunup multi-entry chunking** could collapse adapter-specific code into shared chunks unintentionally. Verify dist layout post-build.
- All adapter-internal failure modes carried over from the prior closed PRs (#38) — tests cover them.

## Testing Strategy

- Reuse the test fixtures + mocks I already wrote for the closed `notify-email` PR; relocate under `tests/adapters/email/`.
- For inapp, use a hand-rolled D1 mock kept minimal to the queries this adapter emits.
- SSE tested at the `Request → Response` boundary — no real EventSource.


## Wiki Context

Auto-populated; no edits.
