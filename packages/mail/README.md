# @workkit/mail

> Typed email client for Cloudflare Workers — send, receive, route, parse

[![npm](https://img.shields.io/npm/v/@workkit/mail)](https://www.npmjs.com/package/@workkit/mail)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/mail)](https://bundlephobia.com/package/@workkit/mail)

## Install

```bash
bun add @workkit/mail
```

## Usage

### Before (raw CF Email Workers API)

```ts
// Sending — manual MIME construction
import { createMimeMessage } from "mimetext"
import { EmailMessage } from "cloudflare:email"

const msg = createMimeMessage()
msg.setSender("noreply@example.com")
msg.setSubject("Hello")
msg.setTo("user@example.com")
msg.addMessage({ contentType: "text/plain", data: "Hi there" })

const raw = new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode(msg.asRaw())); c.close() },
})
await env.SEND_EMAIL.send(new EmailMessage("noreply@example.com", "user@example.com", raw))

// Receiving — raw stream parsing with no types
export default {
  async email(message, env) {
    const reader = message.raw.getReader()
    // manual stream assembly, manual parsing...
  },
}
```

### After (workkit mail)

```ts
import { mail, createEmailHandler, createEmailRouter } from "@workkit/mail"

// Typed sending — one call
const sender = mail(env.SEND_EMAIL, { defaultFrom: "noreply@example.com" })
const { messageId } = await sender.send({
  to: "user@example.com",
  subject: "Hello",
  text: "Hi there",
  html: "<p>Hi there</p>",
  attachments: [{ filename: "report.pdf", content: pdfBuffer, contentType: "application/pdf" }],
})

// Typed receiving — auto-parsed InboundEmail
export default {
  email: createEmailHandler({
    handler(email, env) {
      console.log(email.from, email.subject, email.text)
      // email.forward(), email.reply(), email.setReject() all available
    },
  }),
}

// Pattern-matching router for inbound emails
const router = createEmailRouter()
  .match((e) => e.to.includes("support@"), async (email, env) => {
    await createTicket(email)
  })
  .match((e) => e.to.includes("billing@"), async (email, env) => {
    await routeToBilling(email)
  })
  .default(async (email) => {
    email.setReject("Unknown recipient")
  })

export default { email: router.handle }
```

## API

### Sender

- **`mail(binding, options?)`** — Create a typed mail client from a `SendEmail` binding
  - `.send(message)` — Send an email. Returns `{ messageId }`
  - `.raw` — Access the underlying `SendEmail` binding

**`MailOptions`**:
  - `defaultFrom` — Default sender address (`string | MailAddress`)

**`MailMessage`**:
  - `to` — Recipient(s) (`string | string[]`)
  - `subject` — Subject line
  - `from?` — Sender (overrides `defaultFrom`)
  - `cc?`, `bcc?` — Carbon copy recipients
  - `replyTo?` — Reply-to address
  - `text?` — Plain text body
  - `html?` — HTML body
  - `attachments?` — Array of `MailAttachment`
  - `headers?` — Custom headers (only `X-*` headers are reliable on CF)

### Receiver

- **`createEmailHandler<Env>(options)`** — Wrap the Workers `email()` export with auto-parsing
  - `handler(email, env, ctx)` — Receives a typed `InboundEmail`
  - `onError?(error, email)` — Optional error handler

**`InboundEmail`** fields: `from`, `to`, `subject`, `text?`, `html?`, `headers`, `rawSize`, `messageId?`, `inReplyTo?`, `references?`, `date?`, `attachments`

**`InboundEmail`** methods:
  - `.forward(rcptTo, headers?)` — Forward to a verified address
  - `.reply(message)` — Reply with a new message
  - `.setReject(reason)` — Reject with an SMTP error

### Router

- **`createEmailRouter<Env>()`** — Create a pattern-matching router (first match wins)
  - `.match(predicate, handler)` — Add a route
  - `.default(handler)` — Set fallback handler (rejects if unset)
  - `.handle` — The CF `email()` export handler

### Compose

- **`composeMessage(options)`** — Compose a raw MIME message from structured input
  - Returns `{ raw, from, to }` — MIME string + envelope addresses
  - Supports text, HTML, attachments, inline images, custom headers

### Parse

- **`parseEmail(raw)`** — Parse raw MIME into a structured `ParsedEmail`
  - Accepts `string | ArrayBuffer | Uint8Array | ReadableStream`
  - Returns `{ from, to, subject, text?, html?, messageId?, inReplyTo?, references?, date?, attachments }`

### Validation

- **`validateAddress(address)`** — Validate and normalize. Throws `InvalidAddressError` if invalid.
- **`isValidAddress(address)`** — Returns `boolean`, no throw.

## Errors

All errors extend `WorkkitError` from `@workkit/errors`.

| Class | Code | Status | Retryable |
|-------|------|--------|-----------|
| `MailError` | `WORKKIT_MAIL_ERROR` | 500 | No |
| `InvalidAddressError` | `WORKKIT_MAIL_INVALID_ADDRESS` | 400 | No |
| `DeliveryError` | `WORKKIT_MAIL_DELIVERY_FAILED` | 502 | Yes (exponential backoff, 3 attempts) |

## Wrangler Config

```toml
# wrangler.toml
[[send_email]]
name = "SEND_EMAIL"

# For routing inbound emails, configure Email Routing in the Cloudflare dashboard
# and set the worker as a destination.
```

## License

MIT
