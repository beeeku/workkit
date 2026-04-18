---
title: "Turnstile"
---

# Turnstile

`@workkit/turnstile` is server-side verification for [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) — typed `siteverify` results, AbortSignal-backed timeouts, and a Hono middleware that accepts the token from a header or JSON body.

## Install

```bash
bun add @workkit/turnstile hono
```

## Direct verification

```ts
import { verifyTurnstile } from "@workkit/turnstile";

const result = await verifyTurnstile(token, env.TURNSTILE_SECRET, {
  remoteIp: req.headers.get("cf-connecting-ip") ?? undefined,
  expectedAction: "submit-comment",
  timeout: 5_000,
});

if (!result.success) {
  return new Response(JSON.stringify({ errors: result.errorCodes }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
```

`TurnstileResult`:

```ts
interface TurnstileResult {
  success: boolean;
  challengeTs: string;
  hostname: string;
  errorCodes: string[];
  action?: string;
  cdata?: string;
}
```

`expectedAction` enforces that the token was issued for a specific named action — set the same value in your client widget config to defeat token reuse across endpoints.

## Hono middleware

```ts
import { Hono } from "hono";
import { turnstile } from "@workkit/turnstile";

const app = new Hono<{ Bindings: { TURNSTILE_SECRET: string } }>();

app.use(
  "/api/comments",
  turnstile({
    secretKey: app.env.TURNSTILE_SECRET,
    expectedAction: "submit-comment",
  }),
);

app.post("/api/comments", (c) => {
  const result = c.get("turnstile");  // TurnstileResult, populated on success
  return c.json({ ok: true, verifiedHostname: result.hostname });
});
```

Token discovery order:

1. Header — default `cf-turnstile-response`, override via `headerName`
2. JSON body field — default `cf-turnstile-response`, override via `fieldName` (only parsed when `Content-Type: application/json`)

`remoteIpHeader` controls which header the middleware reads to populate `remoteIp` on the verify call (default `cf-connecting-ip`, which is what Cloudflare sets).

`TurnstileMiddlewareOptions`:

```ts
interface TurnstileMiddlewareOptions {
  secretKey: string;
  headerName?: string;        // default "cf-turnstile-response"
  fieldName?: string;         // default "cf-turnstile-response"
  remoteIpHeader?: string;    // default "cf-connecting-ip"
  expectedAction?: string;
  timeout?: number;           // ms, default 5000
}
```

## Errors

`TurnstileError` is thrown for transport-level failures — network errors, timeouts, malformed `siteverify` responses. **It is not thrown for `success: false`** — that's a normal result you should branch on. The middleware converts both into a `403` response with `{ error, codes }`.

## Idempotency

Pass `idempotencyKey` if you need to re-verify the same token (e.g., on retry after a transient failure). Cloudflare returns the original result rather than rejecting the second call as `timeout-or-duplicate`.

```ts
await verifyTurnstile(token, secret, { idempotencyKey: requestId });
```

## See also

- [Authentication](/workkit/guides/authentication/) — combine with `@workkit/auth` to gate authenticated mutations.
- [Rate Limiting](/workkit/guides/rate-limiting/) — Turnstile blocks bots; rate limiting blocks abusive *humans*. Use both.
- [Cloudflare Turnstile docs](https://developers.cloudflare.com/turnstile/)
