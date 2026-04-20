---
title: "Notifications"
---

# Notifications

`@workkit/notify` is a unified notification dispatch primitive for Cloudflare Workers. One API, pluggable transport adapters that ship as **subpath imports** of the same package — bring the runtime cost of an adapter only when you import it.

## When to use `@workkit/notify` vs `@workkit/mail`

Both packages now share the Cloudflare `send_email` binding as the default email transport — `@workkit/notify`'s `cloudflareEmailProvider` delegates to `@workkit/mail`'s `mail()` under the hood. Pick by what you need:

| You want… | Use |
|---|---|
| Multi-channel dispatch (email + in-app + WhatsApp), preferences, opt-out registry, quiet hours, idempotency, fallback chains, delivery records, test mode | **`@workkit/notify`** (this guide) |
| Send one email, parse one inbound, route inbound by address | **`@workkit/mail`** ([Email](/workkit/guides/email/)) |

| Subpath | Adapter | Optional peers |
|---|---|---|
| `@workkit/notify/email` | Provider-pluggable: Cloudflare `send_email` (default) or Resend HTTP API | `@workkit/mail` (CF provider), `@react-email/render` (React templates) |
| `@workkit/notify/inapp` | D1-backed feed + SSE streaming | — |
| `@workkit/notify/whatsapp` | Meta WA Cloud API (default) + Twilio/Gupshup stubs | — |

Cross-cutting concerns — recipient resolution, channel preferences, opt-out registry, quiet hours, idempotency, fallback chains, delivery records, test mode — live in core. Adapters stay thin.

## Install

```bash
bun add @workkit/notify @workkit/queue @workkit/d1 @workkit/errors zod
# Optional: only if you use React Email components
bun add @react-email/render
```

## D1 schema

Run the SQL in `ALL_MIGRATIONS` once during your migration setup. Add `INAPP_MIGRATION_SQL` and `WA_ALL_MIGRATIONS` for those adapters.

```ts
import { ALL_MIGRATIONS } from "@workkit/notify";
import { INAPP_MIGRATION_SQL } from "@workkit/notify/inapp";
import { WA_ALL_MIGRATIONS } from "@workkit/notify/whatsapp";

for (const sql of [...ALL_MIGRATIONS, INAPP_MIGRATION_SQL, ...WA_ALL_MIGRATIONS]) {
  await env.DB.exec(sql);
}
```

## Define a notification

```ts
import { z } from "zod";
import { define } from "@workkit/notify";

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
      inApp:    {
        title: (p) => `${p.instrument} — Pre-Market Brief`,
        body: (p) => p.summary,
        deepLink: (p) => `/briefs/${p.reportId}`,
      },
    },
    fallback: ["whatsapp", "email", "inApp"],
    priority: "high",
  },
  { enqueue: (job) => env.QUEUE.send(job) },
);

await preMarketBrief.send(
  { reportId: "r1", instrument: "NIFTY", summary: "...", pdfR2Key: "reports/u1/r1.pdf" },
  { userId: "u1" },
);
```

## Wire the queue consumer

```ts
import { createNotifyConsumer } from "@workkit/notify";
import { emailAdapter } from "@workkit/notify/email";
import { inAppAdapter } from "@workkit/notify/inapp";
import { whatsappAdapter, metaWaProvider } from "@workkit/notify/whatsapp";

export const queue = createNotifyConsumer(
  {
    db: env.DB,
    adapters: {
      email: emailAdapter({ /* ... */ }),
      inApp: inAppAdapter({ db: env.DB }),
      whatsapp: whatsappAdapter({
        provider: metaWaProvider({
          accessToken: env.WA_ACCESS_TOKEN,
          phoneNumberId: env.WA_PHONE_NUMBER_ID,
        }),
        db: env.DB,
        userIdFromPhone: async (e164) => /* lookup */ null,
      }),
    },
    resolver: async (userId) => /* lookup verified addresses */ null,
    config: {
      priorityAllowlist: ["pre-market-brief"],
      deliveryRetentionDays: 90,
    },
  },
  (id) =>
    id === "pre-market-brief"
      ? { template: preMarketBrief.channels, fallback: preMarketBrief.fallback }
      : undefined,
);
```

## Email adapter

Provider-pluggable. **Cloudflare `send_email` is the default** — zero config, ships with every Worker deployment, no third-party API key. Resend is the first-class alternative when you need delivery webhooks and auto-opt-out from hard bounces.

### Default: Cloudflare `send_email` binding

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
  markUnsubscribable: ["pre-market-brief"],         // marks this notification as unsubscribable
});
```

- Delegates to `@workkit/mail`'s `mail()` — zero MIME duplication.
- Requires `@workkit/mail` (optional peer): `bun add @workkit/mail`.
- No delivery webhooks on the binding → `autoOptOut` is not available on this provider; bounce synthesis from inbound DSN routing is tracked as a roadmap item.
- Plain-text fallback auto-generated.
- Attachment cap default 40MB; bounded R2 fetch concurrency 4.

### Alternative: Resend

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
- Optional `@react-email/render` peer for React Email components.
- Svix-format webhook verification (`v1,<base64>` HMAC-SHA256), 5-min replay window.
- Hard bounce + complaint → automatic opt-out via injected hook (configurable, default on).
- Attachment cap default 40MB; bounded R2 fetch concurrency 4.

### Migrating from the pre-provider shape

The pre-#52 shape took provider-specific options directly on `emailAdapter()`. Wrap them in the new `provider: …` field:

```diff
- emailAdapter({ apiKey: env.RESEND_API_KEY, from: "…", autoOptOut: { hook } })
+ emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "…", autoOptOut: { hook } }) })
```

## In-app adapter

```ts
import { inAppAdapter, SseRegistry, createSseHandler, feed, markRead } from "@workkit/notify/inapp";

const registry = new SseRegistry();
const inApp = inAppAdapter({ db: env.DB, registry });

const sse = createSseHandler({
  db: env.DB,
  registry,
  auth: async (req) => /* return { userId } | null */ null,
  originAllowlist: ["https://app.example.com"],
  maxConnPerUser: 5,
});

// UI calls these from your API routes
const page = await feed(env.DB, { userId, cursor, limit: 20 });
await markRead(env.DB, { userId, ids: ["..."] });
```

- `feed/markRead/dismiss/unreadCount` query helpers (single-round-trip batched updates).
- Composite `(created_at, id)` opaque cursor; ownership-checked queries block cross-user enumeration.
- SSE handler **requires** an `auth` callback (no anonymous default).
- Per-user connection cap (default 5), origin allowlist, 30s heartbeat, dead-subscriber cleanup on push errors.
- `safeLink` rejects `javascript:`/`data:`/`file:` schemes.
- `forgetInAppUser(db, userId, registry?)` cascades + drops active SSE subs.
- **Single-isolate scope.** Multi-isolate fan-out belongs to a future Durable-Object-backed adapter.

## WhatsApp adapter

```ts
import { whatsappAdapter, metaWaProvider, recordOptIn, MarketingPauseRegistry } from "@workkit/notify/whatsapp";

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
  optOutHook: async (userId, channel, _notificationId, reason) => { /* notify-core's optOut */ },
  userIdFromPhone: async (e164) => /* resolve internal id */ null,
});

// Persist opt-in proof when the user clicks the WhatsApp opt-in button.
await recordOptIn({ db: env.DB }, {
  userId: "u1",
  phoneE164: "+919999999999",
  method: "checkbox-signup",
  sourceUrl: "https://app.example.com/onboarding",
});

// Mount the webhook GET-handshake (Meta requires it for setup).
app.get("/wa/webhook", (req) =>
  provider.handleVerificationChallenge(req.raw, env.WA_WEBHOOK_VERIFY_TOKEN) ??
  new Response("not a verification challenge", { status: 400 }),
);
```

- **Provider-pluggable**: Meta is the reference impl; `twilioWaProvider` and `gupshupWaProvider` are stubs.
- **Opt-in proof required pre-send** — `OptInRequiredError` if missing/revoked.
- **24h session window** auto-routed; outside the window forces template send.
- **DND callback** invoked only for `category: "marketing"` templates.
- **Marketing-pause registry** flips on Meta `account_update.phone_quality` low/flagged webhooks; transactional sends unaffected.
- **Multi-locale STOP keywords** (EN/HI/ES/FR; extensible) auto-trigger opt-out hook. Out-of-order webhook deliveries can't move the inbound timestamp backwards.
- **E.164 enforcement** (validates at both opt-in record and send time) + optional `phoneCipher` for at-rest encryption.
- **R2 etag → media-id cache** (D1-backed, default 30d TTL).
- **Meta webhook GET-handshake** + `X-Hub-Signature-256` HMAC-SHA256 verify.
- **`optOutHook` requires `userIdFromPhone`** — adapter throws at construction otherwise (prevents mis-keyed opt-outs).

## Pipeline (race-safe)

The dispatch pipeline runs INSIDE the queue consumer, not at enqueue time. This makes opt-out, quiet-hours, and idempotency race-safe:

1. Idempotency check (UNIQUE on `idempotency_key`)
2. Resolve recipient
3. Reserve a single delivery row (siblings short-circuit)
4. Read prefs (channels + quiet-hours)
5. Quiet-hours bypass restricted to `priorityAllowlist` + `priority:'high'`
6. **Re-check opt-out** (race-safe vs enqueue time)
7. Walk channels: try adapter; on success update row; on failure continue fallback
8. Final disposition: `sent` / `delivered` / `read` / `skipped` / `failed`

## Compliance

- **`forgetUser(db, userId)`** — cascade delete prefs + opt-outs + delivery records for GDPR / India DPDP. Queue draining is left to the caller.
- **Webhook signature verified per adapter** (refuses without `secret`).
- **`mode: "test"`** validated at the very last step before adapter dispatch.
- **No HTML body content logged.**

## See also

- [PDF Rendering](/workkit/guides/pdf-rendering/) — produce PDF attachments for the email channel.
- [Queues and Crons](/workkit/guides/queues-and-crons/) — `@workkit/queue` powers the dispatcher.
