# @workkit/notify

Unified notification dispatch for Cloudflare Workers. One API, pluggable transport adapters. Owns the cross-cutting concerns once: recipient resolution, channel preferences, opt-out registry, quiet hours, idempotency, fallback chains, delivery records, test mode.

This package is the **core** — adapters live in separate packages (#27 email, #28 in-app, #29 WhatsApp).

## Install

```bash
bun add @workkit/notify @workkit/queue @workkit/d1 @workkit/errors zod
```

## D1 schema

Run the SQL in `ALL_MIGRATIONS` once during your migration setup:

```ts
import { ALL_MIGRATIONS } from "@workkit/notify";
for (const sql of ALL_MIGRATIONS) await env.DB.exec(sql);
```

Three tables land: `notification_prefs`, `notification_optouts`, `notification_deliveries` (with `UNIQUE(idempotency_key)`).

## Quick start

```ts
import { z } from "zod";
import {
  define,
  createNotifyConsumer,
  webhookHandler,
  forgetUser,
  type Adapter,
} from "@workkit/notify";

// 1. Define a notification (compile-time typed payload)
const preMarketBrief = define(
  {
    id: "pre-market-brief",
    schema: z.object({
      reportId: z.string(),
      instrument: z.string(),
      summary: z.string(),
      pdfR2Key: z.string(),
    }),
    channels: {
      whatsapp: { template: "pre_market_brief_v2" },
      email:    { template: "PreMarketBriefEmail" },
      inApp:    { title: (p) => `${p.instrument} — Pre-Market Brief`, body: (p) => p.summary, deepLink: (p) => `/briefs/${p.reportId}` },
    },
    fallback: ["whatsapp", "email", "inApp"],
    priority: "high",
  },
  { enqueue: (job) => env.QUEUE.send(job) },
);

// 2. From a request handler
await preMarketBrief.send(
  { reportId: "r1", instrument: "NIFTY", summary: "...", pdfR2Key: "reports/u1/r1.pdf" },
  { userId: "u1" },
);

// 3. Wire the queue consumer
export const queue = createNotifyConsumer(
  {
    db: env.DB,
    adapters: { whatsapp, email, inApp },                // adapter packages
    resolver: async (userId) => /* lookup verified addresses */,
    config: { priorityAllowlist: ["pre-market-brief"], deliveryRetentionDays: 90 },
    logger: console,
  },
  // notification id → template + fallback chain
  (id) => id === "pre-market-brief" ? { template: preMarketBrief.channels, fallback: preMarketBrief.fallback } : undefined,
);

// 4. Webhooks (delivery status from providers)
const onWaWebhook = webhookHandler({ channel: "whatsapp", db: env.DB, registry, secret: env.WA_WEBHOOK_SECRET });

// 5. Compliance
await forgetUser(env.DB, "u1");
```

## API

### `define(options, deps)`

- `options.id` — stable notification id.
- `options.schema` — Standard Schema for the payload (Zod, Valibot, ArkType all work).
- `options.channels` — `Record<ChannelName, ChannelTemplate>`.
- `options.fallback` — ordered chain. Duplicates rejected at definition.
- `options.priority` — `"normal" | "high"`. `high` only bypasses quiet hours when the notification id is in the consumer's `priorityAllowlist`.
- `deps.enqueue(job)` — caller wires their queue producer.

### `createNotifyConsumer(deps, lookup)`

Returns a `(job: DispatchJob) => Promise<DispatchOutcome>` for your queue handler. The consumer runs the full pipeline (idempotency → recipient → prefs → opt-out → quiet-hours → adapter → records).

### `dispatch(deps, registry, input)`

Lower-level: the pipeline used by `createNotifyConsumer`. Useful if you want to drive dispatch yourself.

### `webhookHandler({ channel, db, registry, secret? })`

Framework-agnostic `(Request) => Promise<Response>`. Verifies signature (when adapter implements `verifySignature`), parses events (when adapter implements `parseWebhook`), and updates delivery records idempotently.

### `forgetUser(db, userId)`

Cascades through `notification_prefs`, `notification_optouts`, `notification_deliveries`. **Queue draining is not included** — call your queue's purge directly if you need it.

### `purgeOlderThan(db, olderThanMs)`

Delete delivery rows older than the supplied window. Wire to a cron.

### Helpers

- `readPreferences`, `upsertPreferences`
- `isOptedOut`, `optOut`, `listOptOuts`
- `isWithinQuietHours`
- `canonicalJson`, `sha256Hex`, `buildIdempotencyKey`
- `insertDelivery`, `updateDeliveryStatus`, `findByIdempotencyKey`
- `AdapterRegistry`, `buildRegistry`

### Adapter shape

```ts
interface Adapter<P> {
  send(args: AdapterSendArgs<P>): Promise<AdapterSendResult>;
  parseWebhook?(req: Request): Promise<WebhookEvent[]>;
  verifySignature?(req: Request, secret: string): Promise<boolean>;
}
```

Adapters are stateless objects. The dispatcher feeds them validated args; they return a status (`sent | delivered | read | failed | bounced`) and an optional `providerId`.

## Security & compliance

- **Opt-out re-checked at dispatch** (not just at enqueue) so a `STOP` between request and queue worker is honored.
- **Idempotency via `UNIQUE(idempotency_key)`** with `(userId, notificationId, payload)` canonical-JSON SHA-256.
- **Quiet hours respect IANA timezone** (uses `Intl.DateTimeFormat` — no offset arithmetic, DST-safe).
- **Priority bypass restricted to allowlist** — random product code can't escalate to `high` and bypass quiet hours.
- **`mode: "test"`** validated at the very last step before adapter call; payloads not persisted to delivery records.
- **Webhook signature verification** required per adapter (the helper refuses to run if `verifySignature` exists without `secret`).
- **Webhook timestamp window** default 5 min; older events rejected.
- **`forgetUser` cascade** for GDPR / India DPDP. Queue draining left to caller.
- **No HTML body content logged.**

## Out of scope (separate issues)

- WhatsApp adapter (#29) — Meta direct + Twilio + Gupshup.
- Email adapter (#27) — Resend + React Email.
- In-app adapter (#28) — D1 + SSE.
- Per-provider rate limiting (lands with each adapter).
- Queue-side draining of pending messages on `forgetUser` (gap in `@workkit/queue`).
- D1/R2-backed editable template registry.

## Versioning

Follows the workkit Constitution — single `src/index.ts` export, no cross-package imports outside declared peer deps. Changesets accompany every public API change.
