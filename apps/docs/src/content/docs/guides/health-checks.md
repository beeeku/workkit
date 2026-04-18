---
title: "Health Checks"
---

# Health Checks

`@workkit/health` is a binding probe + `/health` handler for Cloudflare Workers — concurrent probes, per-probe timeouts, critical vs non-critical aggregation, and a Hono-mountable handler that returns 200/503.

## Install

```bash
bun add @workkit/health hono
```

## Quick start

Because probes need access to per-request bindings, register the route once and create probes inside the handler:

```ts
import { Hono } from "hono";
import { createHealthCheck, kvProbe, d1Probe, r2Probe, queueProbe } from "@workkit/health";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", async (c) => {
  const checker = createHealthCheck([
    kvProbe(c.env.CACHE_KV),
    d1Probe(c.env.DB),
    r2Probe(c.env.UPLOADS, { critical: false }),
    queueProbe(c.env.JOBS, { critical: false }),
  ]);
  const result = await checker.check();
  c.header("Cache-Control", "no-store");
  return c.json(result, result.status === "unhealthy" ? 503 : 200);
});

export default app;
```

If your bindings are exposed at module scope (e.g. tests, or via a global env capture), use `healthHandler()` for one-line setup:

```ts
healthHandler([kvProbe(env.CACHE_KV), d1Probe(env.DB)], { path: "/health" })(app);
```

`healthHandler(...)(app)` registers a `GET` route — call it **once during app construction**, not inside a request middleware (you'd re-register the route every request).

A `GET /health` returns:

```json
{
  "status": "healthy",
  "checks": [
    { "name": "kv", "status": "healthy", "latencyMs": 12, "checkedAt": "..." },
    { "name": "d1", "status": "healthy", "latencyMs": 18, "checkedAt": "..." }
  ],
  "timestamp": "..."
}
```

Status code: `200` for `healthy` or `degraded`, `503` for `unhealthy`. The handler always sets `Cache-Control: no-store`.

## Aggregation

Each probe takes `critical?: boolean` (default `true`):

| Probe outcomes | Result status | HTTP |
|---|---|---|
| All probes healthy | `healthy` | 200 |
| Any non-critical probe fails | `degraded` | 200 |
| Any critical probe fails | `unhealthy` | 503 |

So mark optional bindings (caches, async queues) as `critical: false` so a transient failure degrades but doesn't 503 the whole service.

## Built-in probes

| Probe | What it checks | Side effects |
|---|---|---|
| `kvProbe(kv, opts?)` | `await kv.get("__health__")` | None — null is healthy |
| `d1Probe(db, opts?)` | `SELECT 1 as ok` | None |
| `r2Probe(bucket, opts?)` | `await bucket.head("__health__")` | None |
| `doProbe(ns, opts?)` | `ns.idFromName("__health__")` (no fetch) | None |
| `aiProbe(ai, opts?)` | `typeof ai.run === "function"` | None — does not invoke |
| `queueProbe(queue, opts?)` | `typeof queue.send === "function"` | None — does not enqueue |

`opts: { critical?: boolean; timeout?: number }` is shared across all probes.

## Custom probes

Any object that satisfies `ProbeConfig` works:

```ts
import { createHealthCheck } from "@workkit/health";

const checker = createHealthCheck([
  {
    name: "upstream-api",
    critical: true,
    timeout: 3000,
    check: async () => {
      const res = await fetch("https://api.example.com/ping");
      if (!res.ok) throw new Error(`upstream ${res.status}`);
    },
  },
]);

const result = await checker.check();
const apiOk = await checker.isHealthy("upstream-api");
```

`check()` runs all probes concurrently. Per-probe `timeout` defaults to 5000 ms — late rejections are swallowed so they don't surface as unhandled promise rejections.

## Standalone (no Hono)

If you don't use Hono, call the checker yourself:

```ts
import { createHealthCheck, d1Probe } from "@workkit/health";

const hc = createHealthCheck([d1Probe(env.DB)]);

export default {
  async fetch(req: Request) {
    if (new URL(req.url).pathname === "/health") {
      const result = await hc.check();
      return Response.json(result, {
        status: result.status === "unhealthy" ? 503 : 200,
        headers: { "cache-control": "no-store" },
      });
    }
    // ...
  },
};
```

## Caching

`HealthCheckOptions.cacheTtl` (seconds) caches the aggregated result so a high-traffic `/health` doesn't hammer probes. Most platforms call `/health` every 5–30s, so `cacheTtl: 5` is usually safe.

## See also

- [Logging](/workkit/guides/logging/) — emit structured logs from inside custom probes via `@workkit/logger`.
- [Error Handling](/workkit/guides/error-handling/) — `@workkit/errors` for the failure paths inside your probe handlers.
