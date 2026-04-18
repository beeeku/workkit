# @workkit/turnstile

> Server-side verification for Cloudflare Turnstile with typed results and Hono middleware.

[![npm](https://img.shields.io/npm/v/@workkit/turnstile)](https://www.npmjs.com/package/@workkit/turnstile)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/turnstile)](https://bundlephobia.com/package/@workkit/turnstile)

Wraps the Cloudflare Turnstile [`siteverify`](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) endpoint with typed results, AbortSignal-backed timeouts, and a one-line Hono middleware.

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
  return Response.json({ errors: result.errorCodes }, { status: 403 });
}
```

## Hono middleware

```ts
import { turnstile } from "@workkit/turnstile";

app.use(
  "/api/comments",
  turnstile({ secretKey: env.TURNSTILE_SECRET, expectedAction: "submit-comment" }),
);

app.post("/api/comments", (c) => {
  const result = c.get("turnstile");  // TurnstileResult
  return c.json({ ok: true });
});
```

The middleware reads the token from a header (default `cf-turnstile-response`), falls back to the JSON body field, and sets `remoteIp` from `cf-connecting-ip`.

## Highlights

- Typed `TurnstileResult` (camelCase, normalized from the upstream `error-codes`)
- AbortSignal-backed timeout (default 5s)
- `expectedAction` enforcement to prevent token reuse across endpoints
- `idempotencyKey` for safe re-verification on retry
- `TurnstileError` thrown only for transport-level failures — `success: false` is a normal result you branch on

## Documentation

Full guide: [workkit docs — Turnstile](https://beeeku.github.io/workkit/guides/turnstile/)
