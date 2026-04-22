# Implementation Plan — @workkit/realtime

> HOW only — see spec.md for WHAT and WHY.

## Architecture

New package `packages/realtime/` following the `@workkit/ratelimit` shape (same build, same constitution profile).

**Server side (default export):**
- `createBroker(config)` → returns a class implementing `DurableObject`. Holds `Map<channel, Set<Writer>>` for active subscribers and `Map<channel, RingBuffer>` for replay. The DO instance is channel-scoped via `singleton(namespace, channel)` — each active channel is its own DO.
- DO's `fetch(request)` routes internally:
  - `GET /subscribe` — returns a `ReadableStream<Uint8Array>` with `text/event-stream`, after calling `authorize(channel, request, env)`. Replays buffered events past `Last-Event-ID` before going live.
  - `POST /publish` — reads the event JSON, assigns a monotonic id, appends to ring buffer, fans out to every writer, returns `{ delivered: number }`.
- `publish(namespace, channel, event, data)` — convenience wrapper that does `singleton(namespace, channel).fetch("/publish", …)`.

**Client side (subpath `./client`):**
- `subscribe(url, opts)` — wraps `fetch` + `ReadableStream` (uniform across browser/Bun/Node), tracks `lastEventId`, applies exponential backoff on stream end/error, and (if `pollingAfterMs` configured) swaps to a polling loop against `opts.fallbackPollingUrl`.

### Integration points

| Primitive | Source | Usage |
|---|---|---|
| `singleton(namespace, channel)` | `@workkit/do` | Channel → DO stub lookup. |
| `scheduleAlarm` / `createAlarmHandler` | `@workkit/do` | Optional idle-eviction alarm (release subscriber map after N min of no publish). |
| `createMockDO()` | `@workkit/testing` | Broker unit test: storage mock + operation tracking. |
| SSE framing pattern | `packages/notify/src/adapters/inapp/sse.ts:122-160` | Reference for `data:` / `: keepalive` line shape. Not imported — duplicated in `framing.ts`. |
| `authorize` hook shape | `@workkit/auth` `createAuthHandler` | Match `(req, env) => Promise<T | null>` return-null-means-deny pattern, extended to include `channel`. |

## Key Technical Decisions

1. **Per-channel DO via `singleton`** — reuses `@workkit/do` instead of reimplementing `idFromName`. Channels hibernate independently.
2. **Ring buffer is a plain `{ id, event, data }[]` with a max length** — O(1) push, O(n) replay where n ≤ `replayBufferSize`. No heap, no sorted structure needed.
3. **Monotonic id is a DO-local counter** — scoped per broker instance; resets only when the DO evicts. Clients that see an id decrease on reconnect know their buffer was dropped and can surface a "resync" event if they want.
4. **Writers held as `{ id, write(chunk), close() }`** — same shape as notify's `SseSubscriber`, purpose-built for the DO broker.
5. **`authorize` signature:** `(channel: string, request: Request, env: Env) => Promise<unknown | null>` — null = 403, non-null = allow (optionally typed by the caller for their own use).
6. **Failure isolation:** if one writer's `controller.enqueue` throws, remove that writer and continue fan-out — same pattern as notify's `sse.ts:39-49`.
7. **No storage writes on the publish hot path** — replay buffer lives in DO memory.
8. **Standard Schema (not Zod) for config validation** — constitution rule #2. Config is small enough we'll do a hand-written typed check, no runtime validator dep.

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/realtime/package.json` | Package manifest; declare deps on `@workkit/do`, `@workkit/testing`; single `.` export + `./client` subpath | New |
| `packages/realtime/tsconfig.json` | Standard package tsconfig | New |
| `packages/realtime/bunup.config.ts` | Build config mirroring ratelimit | New |
| `packages/realtime/src/index.ts` | Re-exports `createBroker`, `publish`, types | New |
| `packages/realtime/src/framing.ts` | SSE line encoder — pure, no deps | New |
| `packages/realtime/src/ring-buffer.ts` | Bounded replay buffer with `since(id)` slice | New |
| `packages/realtime/src/broker.ts` | `createBroker()` factory → DO class | New |
| `packages/realtime/src/publish.ts` | `publish(namespace, channel, event, data)` helper | New |
| `packages/realtime/src/client.ts` | Browser `subscribe(url, opts)` wrapper | New |
| `packages/realtime/src/types.ts` | Shared types (`BrokerConfig`, `AuthorizeHook`, `RealtimeEvent`, `SubscribeOptions`) | New |
| `packages/realtime/tests/framing.test.ts` | Framing round-trip, edge cases (multi-line data, unicode) | New |
| `packages/realtime/tests/ring-buffer.test.ts` | Bounded growth, `since()` correctness, id monotonicity | New |
| `packages/realtime/tests/broker.test.ts` | Authorize deny, subscribe flow, publish fan-out, replay-on-reconnect via `createMockDO` | New |
| `packages/realtime/tests/publish.test.ts` | `publish` helper calls DO stub correctly; error surface | New |
| `packages/realtime/tests/client.test.ts` | Reconnect with `Last-Event-ID`, polling fallback swap | New |
| `adr/0005-realtime-sse-over-durable-objects-broker.md` | ADR — why per-channel DO + in-memory ring + no WebSocket in v1 | New |
| `.changeset/realtime-initial.md` | Changeset for new package | New |

## Failure Modes

- **DO eviction mid-session** → replay buffer lost. Client sees `Last-Event-ID` ignored (id counter reset); handled by client surfacing a "resync" event or full reload. Documented.
- **Slow subscriber / back-pressure** → `controller.enqueue` queues in memory. Cap via per-writer max queued bytes? **v1: no cap, trust SSE stream back-pressure**. Revisit if we see runaway memory.
- **`authorize()` throws** → treat as deny, log via `console.error`? No — constitution rule #7 forbids `console.log` in src. Return 403 and swallow. Test asserts this.
- **Proxy strips SSE** → client never receives events. `subscribe()` times out via heartbeat-miss detection, swaps to polling.
- **Flood publisher** → one channel's publish rate exhausts DO wall time. Fire-and-forget, no back-pressure on publisher. Documented as a v1 limitation.
- **Channel-name injection** → validated at subscribe (`^[a-zA-Z0-9:_.-]{1,128}$`). Reject with 400.
- **Concurrent subscriber cap exceeded** → 429 response. Per spec's resolved-value cap of 1000/channel.

## Testing Strategy

- **Unit (pure):** `framing.ts`, `ring-buffer.ts` — no runtime deps, direct `bun test`.
- **Broker:** instantiate the DO class with a `createMockDO()`-backed `DurableObjectState`, call its `fetch()` with synthetic requests, assert stream output + status codes. Use `TransformStream` tee or a simple collector to snapshot subscriber writes.
- **Publish helper:** mock a `DurableObjectNamespace` with an in-process stub that records the fetch URL + body.
- **Client:** mock `globalThis.fetch` with a helper that returns controllable `ReadableStream`s (push/close/error); assert reconnect URL + headers carry `lastEventId` and that `unsubscribe` aborts in-flight fetches.
- **No integration test against `wrangler dev`** in v1 — that belongs in maina-cloud's first-consumer E2E suite.
- **`@workkit/testing` wired** in devDependencies to satisfy constitution rule #3, even if only used in broker.test.ts.

## Tasks

TDD order (tests precede impl). See tasks.md for the full breakdown and dependencies.

## Wiki Context

### Related Modules

- **src** (69 entities) — `modules/src.md` (scaffolded default; re-evaluate after wiki recompile post-merge)

### Suggestions

- Run `maina wiki compile` after merge to index the new package's public API.
