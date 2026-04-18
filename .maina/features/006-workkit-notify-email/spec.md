# Feature: @workkit/notify-email — Resend + React Email adapter

Tracks GitHub issue #27. Depends on #26 (`@workkit/notify` core) — already merged.

## Problem Statement

Without an email adapter, callers can't send the most universal channel through `@workkit/notify`. Resend is the lowest-friction provider for Workers (HTTP API, no SMTP plumbing) and React Email is the de-facto template system. Bundling both as a separate `@workkit/notify-email` package keeps the core dependency-light while letting consumers opt into the React Email runtime cost.

## Target User

- **Primary**: workkit consumers using `@workkit/notify` who need email delivery (entryexit's brief delivery first; future products next).
- **Secondary**: developers writing email-only flows that want the same security defaults (signature verification, auto-opt-out on complaint, replay-window protection).

## User Stories

- As a product engineer, I want `emailAdapter({ provider, from, replyTo, webhook })` registered as the `email` channel so my `notify.define({ channels: { email: ... } })` works.
- As a security engineer, I want webhook signatures verified and stale events rejected.
- As a compliance engineer, I want `email.complained` and hard `email.bounced` to **automatically** add an opt-out so we don't send to that user again.
- As a developer, I want React Email components rendered to HTML + auto-generated plain-text fallback inside a Worker.

## Success Criteria

- [ ] `emailAdapter({...})` returns an `Adapter` shape compatible with `@workkit/notify`'s registry.
- [ ] Sends via Resend's HTTP API; tested against a recorded fixture, not a live network.
- [ ] React Email render produces both HTML and a plain-text fallback (auto-generated when not provided).
- [ ] Attachment size cap enforced before provider call (default 40MB, configurable).
- [ ] R2 attachment fetch parallelized with bounded concurrency (default 4).
- [ ] Webhook signature verified via Svix (`Svix-Signature` HMAC); replay window 5 min.
- [ ] `email.bounced` (hard) → automatic opt-out for `email` + the notification id.
- [ ] `email.complained` → automatic opt-out for `email` (ALL notifications for that user; spec'd as a global channel opt-out).
- [ ] From-domain validation at adapter init (E.164-style strict — reject malformed).
- [ ] Tracking off by default for sensitive notification IDs (configurable allowlist).
- [ ] `@workkit/testing` integration present.
- [ ] Single `src/index.ts` export.
- [ ] Changeset added.
- [ ] LOC budget ≤300 source.

## Scope (v1 PR)

### In Scope

- `emailAdapter(options)` — returns `Adapter<EmailPayload>`.
- Resend HTTP send (no SDK dependency — direct `fetch`).
- React Email rendering via the **`render` function from `@react-email/render`** as an optional peer dep.
- Plain-text fallback auto-generation (HTML → text) when no React text component provided.
- Attachment fetch from R2 (consumer supplies an `R2Bucket`-shape).
- Webhook parser for Resend's standard event shape (delivered/bounced/complained/opened/clicked).
- Signature verification (Svix-style HMAC).
- Auto opt-out on hard bounce + complaint.
- Tracking allowlist (`disableTrackingFor: string[]`).

### Out of Scope (separate concerns)

- Full Resend SDK wrapper.
- MJML or other template systems (callers can pre-render).
- Shared template registry.
- Dedicated rate limiter (use `@workkit/ratelimit` upstream).

## Design Decisions

- **Direct `fetch` to Resend** — no SDK dep, smaller bundle, easier to mock in tests.
- **`@react-email/render` is an optional peer** — caller pays the cost only if using React Email templates. Plain HTML strings work without it.
- **Auto opt-out on complaint is opt-IN by default** — controlled via `autoOptOut: true` (default true) so a single bad actor can't mass-opt-out by spoofing webhooks (signature verification gates this anyway).
- **HMAC verification** — verify Svix-format `Svix-Signature` header (`v1,<base64-sha256>`), not just the secret presence.
- **Attachment streaming** — when total payload > a configurable cap, error with explicit `AttachmentTooLargeError` (no transparent fallback to presigned link in v1; future).

## Open Questions

- Should we ship a tiny `htmlToText` implementation or import one (like `html-to-text`)? — Lean tiny inline impl; the actual conversion only needs strip-tags + collapse-whitespace.
- Should webhook auto-opt-out write to `notify`'s `optOut` helper directly or just emit the event for the consumer to handle? — Lean direct write so the security guarantee is end-to-end. Surface as a configurable callback for callers who want to gate it.
