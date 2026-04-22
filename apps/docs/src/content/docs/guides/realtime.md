---
title: "Realtime"
---

# Realtime

`@workkit/realtime` is an SSE-over-Durable-Objects broadcast primitive for Cloudflare Workers. Fan out events from any Worker handler to every active subscriber of a channel, with Last-Event-ID replay and a fetch-based browser client that survives reconnects.

## When to use it

| You want… | Use |
|---|---|
| Multi-isolate live updates (dashboards, run timelines, presence-ish toasts) | **`@workkit/realtime`** (this guide) |
| Single-isolate SSE for one user's inbox | `@workkit/notify/inapp` |
| Retryable, provider-backed notification delivery (email, SMS, push, WhatsApp) | `@workkit/notify` |

Realtime is *broadcast-to-topic* (fire-and-forget, ephemeral, replay by id). Notify is *deliver-to-user* (retryable, durable, per-provider). Different contracts — pick by failure mode you want.

## Install

```bash
bun add @workkit/realtime @workkit/do
```

## Bind the Durable Object

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "SSE_BROKER"
class_name = "SseBroker"

[[migrations]]
tag = "v1"
new_classes = ["SseBroker"]
```

## Define a broker

`createBroker` returns a `DurableObject` class you export from your Worker. The `authorize` hook is required — return a principal to allow, `null` to deny (produces HTTP 403). Thrown errors are treated as denies.

```ts
// worker.ts
import { createBroker } from "@workkit/realtime";

export const SseBroker = createBroker({
  authorize: async (channel, request, env) => {
    const session = await getSession(request, env);
    if (!session) return null;
    if (channel.startsWith(`team:${session.teamId}:`)) return session;
    if (channel === `member:${session.userId}:notify`) return session;
    return null; // not allowed on this channel
  },
  replayBufferSize: 50,          // default
  maxSubscribersPerChannel: 1000, // default
  heartbeatMs: 30_000,            // default
  channelPattern: /^[a-zA-Z0-9:_.-]{1,128}$/, // default
});
```

## Wire the subscribe route

Route `/sse/:channel` to the broker's DO stub using `singleton(ns, channel)` from `@workkit/do`. Each channel is its own DO instance — hibernation keeps idle channels free.

```ts
import { singleton } from "@workkit/do";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/sse/")) {
      if (request.method !== "GET") {
        return new Response("method not allowed", { status: 405 });
      }
      const channel = url.pathname.slice("/sse/".length);
      const stub = singleton(env.SSE_BROKER, channel);
      return stub.fetch(
        new Request(`https://do/subscribe?channel=${encodeURIComponent(channel)}`, {
          headers: request.headers, // forwards cookie / Last-Event-ID
        }),
      );
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

## Publish from any handler

```ts
import { publish } from "@workkit/realtime";

await publish(env.SSE_BROKER, `run:${runId}`, "run.stage", {
  stage: "ai_verify",
  progress: 40,
});
```

`publish(namespace, channel, event, data)` is fire-and-forget — it resolves with `{ delivered, id }` so you can observe delivery. `data` must not be `undefined` (throws eagerly).

## Subscribe from the browser

```ts
import { subscribe } from "@workkit/realtime/client";

const sub = subscribe(`/sse/run:${runId}`, {
  onEvent: (event, data, id) => {
    if (event === "run.stage") updatePipeline(data);
    if (event === "realtime.reset") location.reload(); // see "Eviction" below
  },
  onReconnect: (attempt) => console.log("reconnecting", attempt),
  backoff: { initialMs: 500, maxMs: 10_000 }, // default
  fallbackPollingUrl: `/poll/run/${runId}`,   // optional
  pollingAfterMs: 45_000,                      // default
});

// later
sub.unsubscribe();
```

The client uses `fetch` + streams (not `EventSource`), so it works identically in browsers, Bun, and Node. Reconnect carries `lastEventId` via both the `Last-Event-ID` header and a `?lastEventId=N` query param.

## Eviction and the `realtime.reset` signal

Durable Objects hibernate and can evict when idle. When they come back, the broker's in-memory id counter starts fresh at 0. If a reconnecting client reports a `Last-Event-ID` higher than the broker's current `lastId`, the broker emits:

```text
event: realtime.reset
id: <current-lastId>
data: {"reason":"buffer_gap","lastKnownId":<client's-id>}
```

**before** any live events. Handle this by discarding local state and re-fetching — your Last-Event-ID is referring to events that no longer exist on the server.

## Channel conventions

The package enforces a syntactic pattern but leaves semantic scoping to you. Typical shapes:

| Channel | Events |
|---|---|
| `team:<id>:runs.live` | `run.started`, `run.stage`, `run.completed` |
| `team:<id>:findings` | `finding.created`, `finding.feedback` |
| `run:<runId>` | `run.stage`, `run.completed` |
| `member:<id>:notify` | `invite.received`, `mention` |

Your `authorize` hook is the gate — the package does not enforce that `team:42:*` requires team 42 membership; you do.

## Limits and failure modes

- **No WebSocket transport in v1.** SSE + optional polling fallback covers the common shapes. WebSocket would earn a separate ADR.
- **Replay is in-memory**, bounded by `replayBufferSize`. Clients disconnected longer than the buffer window miss events — reconnect with `Last-Event-ID` older than the oldest buffered id will replay whatever's left (not the full gap).
- **Each active subscriber keeps its channel's DO awake** — SSE on DO cannot hibernate an in-flight response. Default cap is 1000 subscribers per channel; past that the broker returns 429.
- **No back-pressure on publishers.** A flood on one channel can exhaust the DO's wall time for that tick. Out-of-scope for v1.
- **`authorize()` throwing is treated as deny** — no `console.log` (constitution rule); observability is the caller's job.
- **Channel-name validation** rejects anything outside `^[a-zA-Z0-9:_.-]{1,128}$` with HTTP 400.

## Testing

Unit-test the broker by instantiating the class directly — it holds no DO storage, so a cast `{} as DurableObjectState` is sufficient:

```ts
import { createBroker } from "@workkit/realtime";

const Broker = createBroker({ authorize: async () => ({ userId: "u1" }) });
const broker = new Broker({} as DurableObjectState, {});

const res = await broker.fetch(
  new Request("https://do/publish", {
    method: "POST",
    body: JSON.stringify({ event: "x", data: "y" }),
  }),
);
expect(await res.json()).toEqual({ delivered: 0, id: 1 });
```

See `packages/realtime/tests/` for the full test set — framing, ring buffer, broker, publish, client parser, and client lifecycle.

## Design background

See [`adr/0005-realtime-sse-over-durable-objects-broker.md`](https://github.com/beeeku/workkit/blob/master/adr/0005-realtime-sse-over-durable-objects-broker.md) for the per-channel-vs-sharded DO tradeoff, the in-memory-vs-storage replay decision, and the no-WebSocket-in-v1 rationale.
