---
"@workkit/mail": minor
---

**Add `parseBounceDSN` for RFC 3464 hard/soft bounce detection.** New pure parser turns an `InboundEmail` carrying a delivery-status notification into a structured `BounceInfo`. Detects multipart/report layout and the single-part-in-body variant; classifies via RFC 3463 status-code prefix (`5.x` → hard, `4.x` → soft), with a `Diagnostic-Code` SMTP-class fallback for DSNs that omit `Status`. Returns `null` for non-DSN mail (regular inbound, auto-replies), for DSNs with non-`failed` `Action` (delayed / relayed / delivered), and for malformed DSNs missing `Final-Recipient`.

```ts
import { parseBounceDSN, createEmailRouter } from "@workkit/mail";

createEmailRouter().match(
  (e) => e.to === "bounces@yourdomain.com",
  async (email) => {
    const bounce = parseBounceDSN(email);
    if (bounce?.kind === "hard") {
      // suppress further sends to bounce.recipient
    }
  },
);
```

Foundational for `@workkit/notify`'s upcoming `createBounceRoute` helper, which wires this into the `autoOptOut` hook so the Cloudflare `send_email` transport gets bounce-driven opt-out parity with Resend.

Closes #53.
