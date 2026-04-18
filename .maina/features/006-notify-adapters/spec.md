# Feature: @workkit/notify — email + inapp adapters (subpaths)

Tracks GitHub issues #27 (email) and #28 (in-app). Lives inside `@workkit/notify` per the original #26 spec. Earlier WIP separate packages (`@workkit/notify-email`, `@workkit/notify-inapp`) closed in favor of this restructure.

## Problem Statement

`@workkit/notify` core (#26) shipped without any transports. Without adapters the package is unusable. Two adapters land here together because:

1. They share the same `Adapter` interface and webhook surface.
2. They share install/version/changeset story for "the notification system."
3. The original spec called for sub-paths inside one package — separate packages added discoverability without strong dep-isolation upside (heavy peer deps are handled by `peerDependenciesMeta.optional` already).

The third adapter (WhatsApp, #29) lands in a follow-up PR alongside per-provider rate limiting because it's substantially larger (Meta Cloud API + Twilio + Gupshup) and couples to compliance work (DND India, opt-in proofs).

## Target User

- **Primary**: workkit consumers using `@workkit/notify` for email or in-app notification flows (entryexit's brief delivery + bell-icon inbox).
- **Secondary**: workkit package authors building higher-level UI components that consume the in-app feed.

## User Stories

- As a product engineer, I want `import { emailAdapter } from "@workkit/notify/email"` to register the email channel with my dispatch.
- As a product engineer, I want `import { inAppAdapter, createSseHandler, feed } from "@workkit/notify/inapp"` to wire the bell-icon UI.
- As a security engineer, I want webhook signatures verified (Resend), SSE auth required, and `safeLink` to reject `javascript:`/`data:` URLs.
- As a compliance engineer, I want `email.complained` / `email.bounced(hard)` to auto opt-out, and `forgetUser` to cascade through in-app rows.

## Success Criteria

### Email (`@workkit/notify/email`)

- [ ] `emailAdapter({ apiKey, from, replyTo?, bucket?, webhook?, autoOptOut?, disableTrackingFor? })` returns `Adapter<EmailPayload>`.
- [ ] Direct `fetch` to Resend (no SDK).
- [ ] React Email rendering via optional `@react-email/render` peer; plain HTML strings work without it.
- [ ] Plain-text fallback auto-generated when not provided.
- [ ] Attachment cap default 40MB; `AttachmentTooLargeError`.
- [ ] R2 fetch parallelism bounded (default 4).
- [ ] Webhook verification: Svix-format `v1,<base64>` HMAC-SHA256 + 5-min replay window.
- [ ] `email.complained`/`email.bounced(hard)` → auto opt-out via injected hook.
- [ ] `from` validated at adapter init.
- [ ] `disableTrackingFor` allowlist suppresses tracking for sensitive notification ids.

### In-app (`@workkit/notify/inapp`)

- [ ] `inAppAdapter({ db, sseRegistry? })` returns `Adapter<InAppPayload>`.
- [ ] `feed`, `markRead`, `dismiss`, `unreadCount` query helpers.
- [ ] Composite `(created_at, id)` cursor, opaque base64.
- [ ] `markRead` only updates rows owned by `userId` (cross-user enumeration blocked).
- [ ] `createSseHandler({ db, registry, auth, originAllowlist?, maxConnPerUser? })` enforces auth callback at construction.
- [ ] Per-user connection cap default 5; `429` beyond.
- [ ] Origin allowlist enforced when set; `403` on mismatch.
- [ ] Body length cap ~2KB; `BodyTooLongError`.
- [ ] `safeLink(url)` rejects `javascript:`/`data:`/`file:` schemes.
- [ ] `forgetInAppUser` cascade.
- [ ] D1 migration SQL exported via `INAPP_MIGRATION_SQL`.

### Cross-cutting

- [ ] `package.json` `exports` map adds `./email` and `./inapp` subpaths.
- [ ] Optional peer for `@react-email/render`.
- [ ] `@workkit/testing` integration present.
- [ ] LOC budget ≤500 source for email subpath, ≤350 for inapp subpath.
- [ ] Single changeset bumping `@workkit/notify` minor.

## Scope (v1 PR)

### In Scope

- Both adapters as subpaths of `@workkit/notify`.
- Subpath exports + optional peer dep wiring.
- `safeLink` helper exposed from `inapp` subpath.
- Webhook auto-opt-out hook for email.
- D1 schema export for in-app.

### Out of Scope (separate issues)

- WhatsApp adapter (#29) — bigger, ships alone.
- Cross-isolate SSE fan-out (DOs).
- Push notifications.
- Notification grouping / digests.
- D1/R2 editable template registry.

## Design Decisions

- **Subpath exports** over separate packages — consumers only pay for what they import; optional peer deps mean the React Email runtime is only loaded if used.
- **Single Worker isolate scope for SSE** — multi-isolate fan-out belongs to a future DO-backed adapter; documented loudly.
- **Auto opt-out hook receives email-as-userId** — webhook payloads don't carry our internal id; the hook resolves via the consumer's user table.
- **Body cap 2KB for in-app** — anything longer should live behind a `deepLink`. Document the pattern.
- **`safeLink` rejects by scheme allowlist**, not by regex — `new URL(input).protocol` check.

## Open Questions

- Heartbeat cadence for SSE: 30s default (Workers drop inactive streams). Confirm during implementation.
- Should `markRead` accept `markAll: true`? — Yes, keep it simple.
