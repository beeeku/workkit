# @workkit/mail

## 0.2.0

### Minor Changes

- cf7844c: **Add `parseBounceDSN` for RFC 3464 hard/soft bounce detection.** New pure parser turns an `InboundEmail` carrying a delivery-status notification into a structured `BounceInfo`. Detects multipart/report layout and the single-part-in-body variant; classifies via RFC 3463 status-code prefix (`5.x` → hard, `4.x` → soft), with a `Diagnostic-Code` SMTP-class fallback for DSNs that omit `Status`. Returns `null` for non-DSN mail (regular inbound, auto-replies), for DSNs with non-`failed` `Action` (delayed / relayed / delivered), and for malformed DSNs missing `Final-Recipient`.

  ```ts
  import { parseBounceDSN, createEmailRouter } from "@workkit/mail";

  createEmailRouter().match(
    (e) => e.to === "bounces@yourdomain.com",
    async (email) => {
      const bounce = parseBounceDSN(email);
      if (bounce?.kind === "hard") {
        // suppress further sends to bounce.recipient
      }
    }
  );
  ```

  Foundational for `@workkit/notify`'s upcoming `createBounceRoute` helper, which wires this into the `autoOptOut` hook so the Cloudflare `send_email` transport gets bounce-driven opt-out parity with Resend.

  Closes #53.

### Patch Changes

- Updated dependencies [b26dbbc]
  - @workkit/errors@1.0.4

## 0.1.1

### Patch Changes

- fd832ae: **Cloudflare `send_email` is now the default email transport.** `@workkit/notify`'s email adapter is refactored to be provider-pluggable (matching the WhatsApp provider pattern), with `cloudflareEmailProvider` as the default and `resendEmailProvider` as the first-class alternative. Closes #52.

  **Breaking — `emailAdapter` options shape (pre-1.0).** The `{ apiKey, from, ... }` shape is removed. Callers must explicitly pass a provider:

  ```diff
  - emailAdapter({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } })
  + emailAdapter({ provider: resendEmailProvider({ apiKey: env.RESEND_API_KEY, from: "noreply@x.com", autoOptOut: { hook } }) })
  ```

  Or switch to the new zero-config default:

  ```ts
  emailAdapter({
    provider: cloudflareEmailProvider({
      binding: env.SEND_EMAIL,
      from: "noreply@x.com",
    }),
  });
  ```

  `autoOptOut` now lives on the Resend provider (where webhook events originate); the Cloudflare provider has no delivery webhooks and no `autoOptOut` — bounce synthesis from inbound DSN is tracked in the roadmap (#53 / #54).

  **`@workkit/mail` added as optional peerDependency on `@workkit/notify`.** Only users of `cloudflareEmailProvider` install it.

  **`@workkit/testing` gains `createMockSendEmail` and `createMockForwardableEmail`** — promoted from a private helper in `@workkit/mail`. Matches the `createMockKV` / `createMockD1` / `createMockR2` pattern. `@workkit/mail` tests migrated to consume these.

  **`WebhookSignatureError`** takes a `provider: "resend" | "cloudflare"` arg; error messages now indicate which provider failed verification.

  Follow-ups filed: #53 (parseBounceDSN), #54 (createBounceRoute), #55 (retry strategy in AdapterSendResult), #56 (docs positioning), #57 (SES/Postmark provider stubs).
