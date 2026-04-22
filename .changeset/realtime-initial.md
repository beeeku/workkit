---
"@workkit/realtime": minor
---

**New package: `@workkit/realtime` — SSE-over-Durable-Objects broadcast primitive for Cloudflare Workers.**

Closes the gap called out at `packages/notify/src/adapters/inapp/sse.ts:11` — the single-isolate SSE helper there explicitly defers multi-isolate fan-out to "a future Durable-Object-backed adapter." This is that adapter.

Server side:

```ts
import { createBroker, publish } from "@workkit/realtime";

export const SseBroker = createBroker({
  authorize: async (channel, request, env) => {
    // return a principal or null to deny
  },
  replayBufferSize: 50,         // default
  maxSubscribersPerChannel: 1000, // default
  heartbeatMs: 30_000,           // default
});

// From any Worker handler:
await publish(env.SSE_BROKER, `run:${runId}`, "run.stage", { stage: "verify" });
```

Client side (`@workkit/realtime/client` subpath):

```ts
import { subscribe } from "@workkit/realtime/client";

const sub = subscribe(`/sse/run:${runId}`, {
  onEvent: (event, data, id) => { /* update DOM */ },
  onReconnect: (attempt) => { /* optional */ },
  backoff: { initialMs: 500, maxMs: 10_000 },
  fallbackPollingUrl: `/poll/run/${runId}`,
  pollingAfterMs: 45_000,
});
```

Design highlights (see `adr/0005-realtime-sse-over-durable-objects-broker.md`):

- One Durable Object per channel — addressed via `singleton(namespace, channelName)` from `@workkit/do`.
- In-memory ring buffer replay keyed by `Last-Event-ID` header or `lastEventId` query param.
- `authorize()` returning `null` (or throwing) → HTTP 403 on subscribe.
- Channel name validated against `^[a-zA-Z0-9:_.-]{1,128}$` by default.
- No WebSocket transport in v1; polling fallback in the client covers proxy strip scenarios.

Tracks #111.
