# @workkit/health

> Health checks and dependency probes for Cloudflare Workers bindings.

[![npm](https://img.shields.io/npm/v/@workkit/health)](https://www.npmjs.com/package/@workkit/health)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/health)](https://bundlephobia.com/package/@workkit/health)

Concurrent probes with per-probe timeouts, critical vs non-critical aggregation, and a Hono-mountable `/health` handler that returns 200 (healthy/degraded) or 503 (unhealthy).

## Install

```bash
bun add @workkit/health hono
```

## Usage

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

## Built-in probes

`kvProbe`, `d1Probe`, `r2Probe`, `doProbe`, `aiProbe`, `queueProbe` — all accept `{ critical?, timeout? }`. Probes never trigger side effects (no message sends, no AI calls).

## Custom probes

```ts
import { createHealthCheck } from "@workkit/health";

const checker = createHealthCheck([
  {
    name: "upstream-api",
    timeout: 3000,
    check: async () => {
      const res = await fetch("https://api.example.com/ping");
      if (!res.ok) throw new Error(`upstream ${res.status}`);
    },
  },
]);

const result = await checker.check();
```

## Highlights

- Probes run concurrently — total latency is max(probe), not sum
- `critical: false` probes degrade rather than fail the overall check
- Late rejections after timeout are swallowed (no unhandled-rejection noise)
- `Cache-Control: no-store` set automatically on the `/health` response

## Documentation

Full guide: [workkit docs — Health Checks](https://beeeku.github.io/workkit/guides/health-checks/)
