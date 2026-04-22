# 0005. Realtime SSE-over-Durable-Objects broker

Date: 2026-04-22

## Status

Proposed

Tracks: #111. Feature: `.maina/features/010-realtime/`.

## Context

Cloudflare Workers isolates don't share in-memory state. A subscriber connected to isolate A cannot receive an event published from isolate B, because the two isolates have no shared mutable process. The only Workers primitive that gives a single addressable point of shared state is Durable Objects.

`@workkit/notify` already ships a single-isolate SSE helper (`packages/notify/src/adapters/inapp/sse.ts`) and explicitly defers multi-isolate fan-out to "a future Durable-Object-backed adapter" (line 11). Every Workkit-built app that needs live UI — maina-cloud's dashboard-v1, the `maina run follow` CLI, future deploy dashboards — independently hits the same problem: DO + SSE + reconnect + replay.

We want one tested primitive rather than N copies with subtly different back-off, replay, and auth semantics.

## Decision

Ship a new package `@workkit/realtime` built on **one Durable Object instance per channel**, addressed via `singleton(namespace, channelName)` from `@workkit/do`. The DO holds in-memory `Map<channel, Set<Writer>>` for active subscribers and a per-channel bounded ring buffer for `Last-Event-ID` replay. Publish goes through a DO RPC; subscribe returns a streamed `text/event-stream` response after a caller-supplied `authorize(channel, request, env)` hook allows it.

Client helper is a browser-targeted subpath export (`@workkit/realtime/client`) that wraps `EventSource`, persists `lastEventId`, applies exponential backoff, and optionally swaps to polling after a configured failure window.

Not adopting: WebSocket transport in v1 (earns its own ADR when needed), storage-backed replay (would invert the ephemeral contract), sharded multi-channel DO (complexity with no scale win at current usage), framing extraction to a shared helper package (~20 lines — premature).

## Consequences

### Positive

- Single tested implementation of the fan-out primitive across Workkit apps.
- Clean long-term home for future realtime transports (WebSocket v2, MQTT bridge, presence) — they slot into this package, not into notify.
- Reuses `@workkit/do`'s `singleton` + alarm helpers; no duplicated `idFromName` plumbing.
- `@workkit/notify` stays focused on durable, retryable delivery semantics — its contract doesn't drift to cover ephemeral broadcast.

### Negative

- Each active channel is a live DO instance. Per-channel isolation is the intended property, but it does mean a burst of 10k distinct short-lived channels creates 10k DO instances (short hibernation + eviction make this low-cost, not zero).
- SSE on DO cannot hibernate an in-flight HTTP response body. Each subscriber keeps its channel's DO awake for the connection's lifetime. We cap subscribers per channel at 1000 (429 beyond) to bound this.
- In-memory ring buffer is lost on DO eviction. Clients whose `Last-Event-ID` predates eviction receive a fresh id stream and are expected to do a reload/resync.
- ~20 lines of SSE framing are duplicated between `notify` and `realtime`. Accepted tradeoff vs. premature extraction.

### Neutral

- Adds one package to the monorepo (33 → 34).
- Adds a DO binding requirement for consumers (`[[durable_objects.bindings]] name = "SSE_BROKER"`). Matches the existing pattern consumers already use for workflow / approval / health DOs.

## High-Level Design

### System Overview

```
┌─ Worker handler ─────────┐                    ┌─ Browser ────────────────┐
│                          │                    │                          │
│  publish(ns, ch, e, d) ──┼──┐              ┌──┼──> subscribe(url, opts) │
│                          │  │              │  │     (EventSource +      │
└──────────────────────────┘  │              │  │      backoff + polling) │
                              │              │  └──────────────────────────┘
                              ▼              │
                       ┌─ DO: channel "ch" ──┴─┐
                       │  Set<Writer> subs     │
                       │  RingBuffer<Event>    │
                       │  fetch()              │
                       │    GET  /subscribe    │
                       │    POST /publish      │
                       └───────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Reuses |
|---|---|---|
| `framing.ts` | SSE line encoding (`event:`, `id:`, `data:`, comments). Pure. | — (mirrors `notify/…/sse.ts:122-160`) |
| `ring-buffer.ts` | Bounded FIFO with monotonic id and `since(id)` slice. Pure. | — |
| `broker.ts` | `createBroker(config)` returns a `DurableObject` class with `fetch()` routing `/subscribe` + `/publish`. | `framing`, `ring-buffer` |
| `publish.ts` | `publish(namespace, channel, event, data)` convenience over DO stub fetch. | `@workkit/do` `singleton` |
| `client.ts` | Browser `subscribe(url, opts)` — `EventSource` wrapper with backoff + polling fallback. | — |
| `types.ts` | `RealtimeEvent`, `BrokerConfig`, `AuthorizeHook`, `SubscribeOptions`, `PublishResult`. | `@workkit/types` where applicable |

### Data Flow

**Publish:** handler → `publish(ns, channel, event, data)` → `singleton(ns, channel).fetch("/publish", { body })` → DO increments id, appends to ring, iterates `Set<Writer>`, calls each `controller.enqueue(encoded)`, returns `{ delivered: n }`.

**Subscribe:** client `GET /sse/:channel` (caller-routed) → caller's Worker invokes `singleton(ns, channel).fetch("/subscribe", { headers: { "Last-Event-ID": … } })` → DO runs `authorize(channel, request, env)`; if null → 403; else creates a `ReadableStream`, registers the `Writer` in the channel's `Set`, replays `ringBuffer.since(lastId)`, emits `: connected`, starts heartbeat interval, returns `Response(stream, { headers: { "content-type": "text/event-stream" } })`.

**Reconnect:** client's `onerror` fires → closes `EventSource` → exponential backoff wait → new `EventSource` with `Last-Event-ID: <persisted>` header → server replays missed events past that id, up to buffer capacity.

### External Dependencies

- `@workkit/do` — `singleton(namespace, name)` stub lookup; alarm helpers (used only if v1.1 adds idle eviction).
- `@workkit/testing` (dev) — `createMockDO()` for broker unit tests; satisfies constitution rule #3.
- `@cloudflare/workers-types` — `DurableObject`, `DurableObjectNamespace`, `DurableObjectState`.
- No runtime deps on notify, auth, or api — realtime is a peer primitive.

## Low-Level Design

### Interfaces & Types

```ts
export interface RealtimeEvent {
  event: string;        // SSE event name
  data: unknown;        // JSON-serializable payload (broker JSON.stringifies)
  id?: number;          // assigned by broker; callers never set
}

export type AuthorizeHook<TPrincipal = unknown> = (
  channel: string,
  request: Request,
  env: unknown,
) => Promise<TPrincipal | null>;

export interface BrokerConfig<TPrincipal = unknown> {
  authorize: AuthorizeHook<TPrincipal>;
  replayBufferSize?: number;          // default 50
  maxSubscribersPerChannel?: number;  // default 1000
  heartbeatMs?: number;               // default 30_000
  channelPattern?: RegExp;            // default /^[a-zA-Z0-9:_.-]{1,128}$/
}

export interface SubscribeOptions {
  onEvent: (event: string, data: unknown, id: number) => void;
  onReconnect?: (attempt: number) => void;
  backoff?: { initialMs: number; maxMs: number };  // default 500 / 10_000
  fallbackPollingUrl?: string;
  pollingAfterMs?: number;                          // default 45_000
  signal?: AbortSignal;
}

export interface PublishResult {
  delivered: number;
  id: number;
}
```

### Function Signatures

```ts
export function createBroker<TEnv, TPrincipal>(
  config: BrokerConfig<TPrincipal>,
): new (state: DurableObjectState, env: TEnv) => DurableObject;

export function publish(
  namespace: DurableObjectNamespace,
  channel: string,
  event: string,
  data: unknown,
): Promise<PublishResult>;

// Subpath @workkit/realtime/client
export function subscribe(
  url: string,
  opts: SubscribeOptions,
): { unsubscribe(): void };
```

### DB Schema Changes

None. No storage writes in v1.

### Sequence of Operations

**Subscribe (happy path):**
1. Caller Worker: `singleton(env.SSE_BROKER, channel).fetch("/subscribe", { headers })`.
2. DO: validate channel name against `channelPattern`. If mismatch → 400.
3. DO: `await authorize(channel, request, env)`. If returns null or throws → 403.
4. DO: if `subs.get(channel)?.size >= maxSubscribersPerChannel` → 429.
5. DO: create `ReadableStream`; on `start(controller)` → create Writer, register in `subs.get(channel)`, replay `ringBuffer.get(channel).since(lastEventId)`, enqueue `: connected`, start heartbeat interval.
6. DO: return 200 with `text/event-stream` headers.
7. Caller Worker forwards the `Response` to the browser unchanged.

**Publish (happy path):**
1. Caller Worker: `publish(ns, channel, "run.stage", { stage: "verify" })`.
2. DO: `POST /publish` arrives with `{ event, data }`.
3. DO: `id = ++counter[channel]`; `ringBuffer.get(channel).push({ id, event, data })`.
4. DO: for each writer in `subs.get(channel)`: try `controller.enqueue(framing.encodeEvent({ id, event, data: JSON.stringify(data) }))`; on throw, mark for removal.
5. DO: prune failed writers.
6. DO: respond `{ delivered: subs.size, id }`.

### Error Handling

- `authorize` throws → treated as deny → 403, no stack exposed. No logging (constitution rule #7 — no `console.log`); observability is caller's responsibility via their own logger.
- Writer `enqueue` throws → writer removed from set, fan-out to others continues. Pattern matches `packages/notify/src/adapters/inapp/sse.ts:39-49`.
- Malformed publish body → 400.
- Channel pattern mismatch → 400.
- Subscribe cap exceeded → 429.

### Edge Cases

- **DO eviction between publishes:** counter and ring buffer reset. Clients reconnecting with an old `Last-Event-ID` see lower ids and should treat as "buffer lost."
- **Client reconnect faster than heartbeat:** no duplicate delivery because replay is bounded by `lastEventId`.
- **Simultaneous publish and subscribe:** JS single-threaded inside a DO — serialized.
- **Subscriber closes mid-replay:** `controller.enqueue` throws on the next event, writer is pruned; no crash.
- **Caller passes a channel name that collides across tenants (e.g. two apps both using `"general"`):** prevented by the caller's naming convention (`team:<id>:<topic>`); package does not enforce tenant prefixes.
- **Publisher floods a channel:** no back-pressure in v1. Documented as a limitation.
- **Heartbeat while client is in EventSource-retry state:** `: keepalive` comment is ignored by `EventSource`; harmless.
