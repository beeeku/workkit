---
"@workkit/notify": minor
---

**Add `createBounceRoute` to `@workkit/notify/email` for Cloudflare-transport bounce handling.** The Cloudflare `send_email` binding has no delivery-webhook surface, so the Resend-style `autoOptOut` path isn't available on `cloudflareEmailProvider`. This helper closes the gap: feed an inbound DSN routed via Cloudflare Email Routing into the same `EmailOptOutHook` shape your Resend setup uses.

```ts
import { createEmailRouter } from "@workkit/mail";
import { createBounceRoute } from "@workkit/notify/email";
import { optOut } from "@workkit/notify";

const bounces = createBounceRoute({
  optOutHook: async (address, channel, _nid, reason) => {
    const userId = await lookupUserIdByEmail(address);
    if (userId) await optOut(env.DB, userId, channel, null, reason);
  },
});

export default {
  email: createEmailRouter()
    .match((e) => e.to === "bounces@yourdomain.com", bounces)
    .default((e) => e.setReject("Unknown recipient"))
    .handle,
};
```

Hard bounces (RFC 3463 `5.x`) fire the opt-out hook with `reason: "hard-bounce"`; soft bounces (`4.x`) no-op so transient failures don't silently drop subscribers; non-DSN messages route through the optional `onNonBounce` callback (or are dropped). Hook errors propagate so the MTA retries.

Built on `parseBounceDSN` from `@workkit/mail` (same release).

Closes #54.
