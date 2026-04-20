---
title: "Email"
---

# Email

`@workkit/mail` is a typed email primitive for Cloudflare Workers — outbound send via the [`SendEmail` binding](https://developers.cloudflare.com/email-routing/email-workers/send-email/), inbound parsing for [Email Routing](https://developers.cloudflare.com/email-routing/email-workers/), pattern-matching router, and MIME composition with attachments. No third-party API dependency.

## When to use `@workkit/mail` vs `@workkit/notify`

Both packages now share the Cloudflare `send_email` binding as the default transport — `@workkit/notify`'s `cloudflareEmailProvider` delegates to `@workkit/mail`'s `mail()` under the hood. Pick by what you need:

| You want… | Use |
|---|---|
| Send one email, parse one inbound, route inbound by address | **`@workkit/mail`** (this guide) |
| Multi-channel dispatch (email + in-app + WhatsApp), preferences, opt-out registry, quiet hours, idempotency, fallback chains, delivery records, test mode | **`@workkit/notify`** ([Notifications](/workkit/guides/notifications/)) |

You don't need to know that notify delegates to mail — pick the package whose surface matches your problem and the other stays out of your way.

## Install

```bash
bun add @workkit/mail
```

## Send

```ts
import { mail } from "@workkit/mail";

const client = mail(env.EMAIL, { defaultFrom: "noreply@example.com" });

const { messageId } = await client.send({
  to: "user@example.com",
  subject: "Welcome",
  text: "Welcome to the service.",
  html: "<h1>Welcome</h1><p>Welcome to the service.</p>",
});
```

`mail(binding, options?)` returns a `TypedMailClient`. The `binding` is the Cloudflare `SendEmail` binding declared in your `wrangler.toml` under `[[send_email]]`.

`MailMessage` accepts:

```ts
interface MailMessage {
  readonly to: string | string[];
  readonly subject: string;
  readonly from?: string | MailAddress;     // falls back to defaultFrom
  readonly cc?: string | string[];
  readonly bcc?: string | string[];
  readonly replyTo?: string | MailAddress;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: readonly MailAttachment[];
  readonly headers?: Readonly<Record<string, string>>;  // X-* headers only
}
```

### Attachments

```ts
await client.send({
  to: "user@example.com",
  subject: "Your invoice",
  text: "Attached.",
  attachments: [
    {
      filename: "invoice.pdf",
      content: pdfBytes,            // string | ArrayBuffer | Uint8Array
      contentType: "application/pdf",
    },
    {
      filename: "logo.png",
      content: pngBytes,
      contentType: "image/png",
      inline: true,
      contentId: "logo",            // <img src="cid:logo">
    },
  ],
});
```

## Compose without sending

`composeMessage()` returns the raw RFC 5322 message string — useful for testing, signing, or pushing to alternative transports:

```ts
import { composeMessage } from "@workkit/mail";

const composed = composeMessage({
  from: "noreply@example.com",
  to: "user@example.com",
  subject: "hello",
  text: "world",
});
console.log(composed.raw);   // full MIME envelope
console.log(composed.from);  // canonical from address
console.log(composed.to);    // recipients[]
```

## Receive — single handler

```ts
import { createEmailHandler } from "@workkit/mail";

export default {
  email: createEmailHandler({
    handler: async (inbound, env, ctx) => {
      if (inbound.subject?.startsWith("UNSUBSCRIBE")) {
        await env.DB.prepare("UPDATE users SET subscribed = 0 WHERE email = ?")
          .bind(inbound.from)
          .run();
        return;
      }
      inbound.setReject("Unknown subject prefix");
    },
    onError: (err, inbound) => {
      console.error("inbound handler failed", inbound.messageId, err);
      inbound.setReject("Internal error");
    },
  }),
};
```

`InboundEmail` exposes structured fields plus three convenience methods:

```ts
interface InboundEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly headers: Headers;
  readonly attachments: readonly ParsedAttachment[];
  readonly messageId?: string;
  readonly inReplyTo?: string;

  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: ReplyMessage): Promise<void>;
  setReject(reason: string): void;
}
```

## Receive — pattern router

For multiple inbound flows, use the router:

```ts
import { createEmailRouter } from "@workkit/mail";

const router = createEmailRouter<Env>();

router
  .match((email) => email.subject?.startsWith("[support]"), async (email, env) => {
    await createSupportTicket(env, email);
  })
  .match((email) => email.from.endsWith("@billing.example.com"), async (email, env) => {
    await processBillingNotification(env, email);
  })
  .default(async (email) => email.setReject("No matching route"));

export default {
  email: (msg, env, ctx) => router.handle(msg, env, ctx),
};
```

Routes are checked in order — first match wins. If none match and no `default()` is set, the email is rejected.

## Address validation

`validateAddress(addr)` throws `InvalidAddressError` on malformed addresses; `isValidAddress(addr)` returns a boolean. Both run automatically on every `send()` for `from`/`to`/`cc`/`bcc`.

## Errors

| Class | When |
|---|---|
| `MailError` | Base; never thrown directly |
| `InvalidAddressError` | Address fails RFC 5321 validation |
| `DeliveryError` | `binding.send()` rejected (auth, quota, upstream) |

All extend `WorkkitError` from `@workkit/errors`.

## See also

- [Notifications](/workkit/guides/notifications/) — `@workkit/notify` builds on top of `@workkit/mail` for preference-aware dispatch.
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/email-workers/) — required to receive inbound mail.
