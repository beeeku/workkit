# @workkit/notify

Unified notification dispatch for Cloudflare Workers. One API, pluggable transport adapters. Owns the cross-cutting concerns once: recipient resolution, channel preferences, opt-out registry, quiet hours, idempotency, fallback chains, delivery records, test mode.

Adapters ship as **subpath imports** in this same package — bring the runtime cost of an adapter only when you import it.

| Subpath | Adapter | Optional peer |
|---|---|---|
| `@workkit/notify/email` | Pluggable provider — Cloudflare `send_email` (default) or Resend HTTP API + React Email | `@workkit/mail`, `@react-email/render` |
| `@workkit/notify/inapp` | D1-backed feed + SSE streaming | — |
| `@workkit/notify/whatsapp` | Meta WA Cloud API (default) + Twilio/Gupshup stubs | — |

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

## Adapters

### Email — `@workkit/notify/email`

Provider-pluggable. **Cloudflare `send_email` is the default** (zero config, ships with every Worker deployment). Resend is the first-class alternative when you want delivery webhooks, hard/soft bounce tracking, and auto-opt-out.

#### Default: Cloudflare `send_email` binding

```toml
# wrangler.toml
[[send_email]]
name = "SEND_EMAIL"
```

```ts
import { emailAdapter, cloudflareEmailProvider } from "@workkit/notify/email";

const email = emailAdapter({
  provider: cloudflareEmailProvider({
    binding: env.SEND_EMAIL,
    from: "Reports <reports@entryexit.ai>",
    replyTo: "support@entryexit.ai",                // optional
  }),
  bucket: env.REPORTS,                              // optional, only for attachments
  markUnsubscribable: ["pre-market-brief"],         // attaches List-Unsubscribe headers
});
```

- Delegates to `@workkit/mail`'s `mail()` — zero MIME duplication.
- Requires `@workkit/mail` (optional peer dep) — `bun add @workkit/mail`.
- No delivery webhooks on the binding → `autoOptOut` is not available on this provider; bounce synthesis from inbound DSN routing is tracked in the roadmap (#54).
- Plain-text fallback auto-generated.
- Attachments forwarded as raw bytes; attachment cap default 40MB; bounded R2 fetch concurrency 4.

#### Alternative: Resend

```ts
import { emailAdapter, resendEmailProvider } from "@workkit/notify/email";
import { optOut } from "@workkit/notify";

const email = emailAdapter({
  provider: resendEmailProvider({
    apiKey: env.RESEND_API_KEY,
    from: "Reports <reports@entryexit.ai>",
    webhook: { maxAgeMs: 5 * 60 * 1000 },
    autoOptOut: {
      enabled: true,
      hook: async (emailAddress, channel, _notificationId, reason) => {
        const userId = await lookupUserIdByEmail(emailAddress);
        if (userId) await optOut(env.DB, userId, channel, null, reason);
      },
    },
  }),
  bucket: env.REPORTS,
  markUnsubscribable: ["pre-market-brief"],
});
```

- Direct `fetch` to Resend (no SDK).
- Optional `@react-email/render` for React Email components.
- Svix-format webhook verification (`v1,<base64>` HMAC-SHA256), 5-min replay window.
- Hard bounce + complaint → auto opt-out (configurable, default on).
- Attachment cap default 40MB; bounded R2 fetch concurrency 4.

#### Migrating from the pre-provider shape

```diff
- emailAdapter({ apiKey: env.RESEND_API_KEY, from: "…", autoOptOut: { hook } })
+ emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "…", autoOptOut: { hook } }) })
```

### In-app — `@workkit/notify/inapp`

```ts
import {
  inAppAdapter,
  SseRegistry,
  createSseHandler,
  feed,
  markRead,
  forgetInAppUser,
  INAPP_MIGRATION_SQL,
} from "@workkit/notify/inapp";

await env.DB.exec(INAPP_MIGRATION_SQL); // adds in_app_notifications table
const registry = new SseRegistry();

const inApp = inAppAdapter({ db: env.DB, registry });

// Mount the SSE route in your router
const sse = createSseHandler({
  db: env.DB,
  registry,
  auth: async (req) => /* return { userId } | null */,
  originAllowlist: ["https://app.example.com"],
  maxConnPerUser: 5,
});

// Feed queries (UI calls these from your API routes)
const page = await feed(env.DB, { userId, cursor, limit: 20 });
await markRead(env.DB, { userId, ids: ["..."] });
```

- `feed/markRead/dismiss/unreadCount` query helpers.
- Composite `(created_at, id)` opaque cursor; cross-user enumeration blocked.
- `markRead` only updates rows owned by `userId`.
- SSE handler **requires** an `auth` callback (no anonymous default).
- Per-user connection cap, origin allowlist, body cap (~2KB).
- `safeLink` rejects `javascript:`/`data:`/`file:` schemes.
- `forgetInAppUser(db, userId, registry?)` cascades + drops active SSE subs.

### WhatsApp — `@workkit/notify/whatsapp`

```ts
import {
  whatsappAdapter,
  metaWaProvider,
  twilioWaProvider,
  gupshupWaProvider,
  recordOptIn,
  MarketingPauseRegistry,
  WA_ALL_MIGRATIONS,
} from "@workkit/notify/whatsapp";

for (const sql of WA_ALL_MIGRATIONS) await env.DB.exec(sql);

const provider = metaWaProvider({
  accessToken: env.WA_ACCESS_TOKEN,
  phoneNumberId: env.WA_PHONE_NUMBER_ID,
});
const pauseRegistry = new MarketingPauseRegistry();

const whatsapp = whatsappAdapter({
  provider,
  db: env.DB,
  bucket: env.MEDIA,
  pauseRegistry,
  dndCheck: async (e164) => /* TRAI lookup */ false,
  optOutHook: async (userId, channel, _notificationId, reason) => {
    /* notify-core's optOut() helper */
  },
  userIdFromPhone: async (e164) => /* lookup your internal id */ null,
});

// Persist opt-in proof when the user clicks the WhatsApp opt-in.
await recordOptIn({ db: env.DB }, {
  userId: "u1",
  phoneE164: "+919999999999",
  method: "checkbox-signup",
  sourceUrl: "https://app.example.com/onboarding",
});

// Mount the webhook (signature verification + handshake)
app.get("/wa/webhook", (req) =>
  provider.handleVerificationChallenge(req.raw, env.WA_WEBHOOK_VERIFY_TOKEN) ??
  new Response("not a verification challenge", { status: 400 }),
);
```

- **Provider-pluggable**: `metaWaProvider` is the reference impl; `twilioWaProvider` and `gupshupWaProvider` are stubs (community contribution welcome).
- **Opt-in proof required pre-send** — `OptInRequiredError` if the proof row is missing or revoked.
- **24h session window** auto-routed: outside the window forces template send; inside allows session text.
- **DND callback** invoked only for `category: "marketing"` templates (transactional exempt).
- **Marketing-pause registry** flips on quality-rating webhooks (`account_update.phone_quality` low/flagged); transactional sends unaffected.
- **Inbound STOP/UNSUBSCRIBE** keywords (multi-locale: EN/HI/ES/FR) trigger automatic opt-out via the injected hook.
- **E.164 enforcement**, optional `phoneCipher` for at-rest encryption.
- **R2 etag → media-id cache** so the same R2 object isn't re-uploaded per recipient (default 30d TTL, matches Meta retention).
- **Meta webhook GET-handshake** handler bundled.
- **Single-isolate scope** for the marketing-pause flag; multi-isolate fan-out via Durable Object is a v2 concern.

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

- Twilio + Gupshup full WhatsApp implementations — interface stable; community contribution welcome.
- Per-provider rate limiting (lands with each adapter).
- Queue-side draining of pending messages on `forgetUser` (gap in `@workkit/queue`).
- D1/R2-backed editable template registry.
- Cross-isolate SSE fan-out (DO-backed adapter — future).
- Cross-isolate WhatsApp marketing-pause coordination (DO-backed — future).
- Push notifications (FCM/APNs — future).
- Rich interactive WhatsApp templates (buttons, lists) — future.

## Versioning

Follows the workkit Constitution — single `src/index.ts` export, no cross-package imports outside declared peer deps. Changesets accompany every public API change.
