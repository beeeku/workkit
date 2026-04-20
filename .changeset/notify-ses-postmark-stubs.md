---
"@workkit/notify": minor
---

**Add `sesEmailProvider` and `postmarkEmailProvider` stubs to `@workkit/notify/email`.** Mirrors the WhatsApp adapter's existing stub pattern (`twilioWaProvider`, `gupshupWaProvider`) — `send` / `parseWebhook` / `verifySignature` throw `NotImplementedError` with a link to the tracking issue (#57), but the option types, the conformance to `EmailProvider`, and the export surface are stable so a real implementation can drop in without touching the adapter or caller code.

```ts
import { emailAdapter, sesEmailProvider, postmarkEmailProvider } from "@workkit/notify/email";

// Same emailAdapter, different provider — the adapter is provider-agnostic.
const ses = emailAdapter({
  provider: sesEmailProvider({
    region: "us-east-1",
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    from: "Reports <reports@entryexit.ai>",
  }),
});
```

Closes #57.
