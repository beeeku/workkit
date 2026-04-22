# Task Breakdown — @workkit/realtime

## Tasks

Each task is one commit. Test tasks precede implementation tasks (TDD always — constitution rule #9).

### Scaffold
- [x] T01 — Create `packages/realtime/` with `package.json`, `tsconfig.json`, `bunup.config.ts`, empty `src/index.ts`. Declare deps on `@workkit/do` + `@workkit/testing` (dev). Wire `.` and `./client` subpath exports. Verify `bun run constitution:check` passes on the scaffold.

### Framing (pure)
- [x] T02 — `tests/framing.test.ts`: encode round-trip (event+id+data), multi-line data string, unicode, missing id.
- [x] T03 — `src/framing.ts`: `encodeEvent({event, id, data}) → Uint8Array`, `encodeComment(text) → Uint8Array` (for heartbeat + `: connected`).

### Ring buffer (pure)
- [x] T04 — `tests/ring-buffer.test.ts`: bounded capacity, FIFO trim, `since(id)` returns events with id > argument in order, empty buffer.
- [x] T05 — `src/ring-buffer.ts`: `createRingBuffer(capacity)` with `push(event)`, `since(id)`, `nextId` getter. Monotonic id from `performance.now`-seeded counter? No — plain `++n`, since counter survives only while DO is alive (documented in spec).

### Types
- [x] T06 — `src/types.ts`: `RealtimeEvent`, `BrokerConfig`, `AuthorizeHook`, `SubscribeOptions`, `PublishResult`. No behavior; consumed by the next tasks.

### Broker DO
- [x] T07 — `tests/broker.test.ts`: `authorize` returning null → 403; invalid channel name → 400; subscribe → stream emits `: connected` and publisher events; `Last-Event-ID` → replay then live; writer throwing during fan-out → removed, others still delivered.
- [x] T08 — `src/broker.ts`: `createBroker({ authorize, replayBufferSize, maxSubscribersPerChannel, heartbeatMs })` returns a `DurableObject` class. Routes `GET /subscribe` and `POST /publish` on its internal `fetch`. Idle-eviction alarm optional (v1: skip — DO hibernates on its own).

### Publish helper
- [x] T09 — `tests/publish.test.ts`: calls `singleton(ns, channel).fetch("/publish", ...)` with correct body; surfaces non-2xx as thrown Error.
- [x] T10 — `src/publish.ts`: `publish(namespace, channel, event, data)` → `Promise<PublishResult>`.

### Client wrapper
- [x] T11 — `tests/client.test.ts`: mock `globalThis.fetch` with controllable `ReadableStream`s — first connect → receives events; stream closes/errors → reconnects with `Last-Event-ID` header + `?lastEventId=` query param; N consecutive failures → calls `fallbackPollingUrl`; `unsubscribe()` aborts the fetch.
- [x] T12 — `src/client.ts`: `subscribe(url, opts)` returns `{ unsubscribe() }`. Backoff from `opts.backoff` (default 500ms → 10s exponential). Persists `lastEventId` in closure.

### Public exports
- [x] T13 — `src/index.ts`: re-export `createBroker`, `publish`, all types. No default export. Verify tree-shakability.

### Docs + ADR
- [x] T14 — `adr/0005-realtime-sse-over-durable-objects-broker.md`: ADR capturing per-channel DO vs. sharded, in-memory ring vs. storage, no-WebSocket-in-v1.
- [x] T15 — `.changeset/realtime-initial.md`: `@workkit/realtime@0.1.0` minor, summary linking #111.

### Verify
- [x] T16 — `bun run typecheck && bun run test --filter @workkit/realtime && bun run lint && bun run constitution:check`. All clean.
- [x] T17 — `maina verify` on staged diff. `maina review` two-stage pass. `maina slop` on changed files.

## Dependencies

```text
T01 ─┬─> T02 ─> T03
     ├─> T04 ─> T05
     ├─> T06 ─> T07 ─> T08 ─> T09 ─> T10
     │                                  │
     │                                  └─> T13
     ├─> T11 ─> T12 ─────────────────────┘
     └─> T14
T13, T15 ─> T16 ─> T17
```

Critical path: T01 → T06 → T07 → T08 → T13 → T16 → T17 (≈ 7 sequential commits; others parallelize).

## Definition of Done

- [x] All tests pass (`bun run test`) — 67 passing
- [x] Biome lint clean (`bun run lint`)
- [x] TypeScript compiles (`bun run typecheck`)
- [x] `bun run constitution:check` — 0 errors, 0 warnings on this package
- [x] `maina verify` clean on final diff
- [x] `maina review` two-stage pass with no critical/important findings (independent review + Copilot + CodeRabbit addressed)
- [x] `maina slop` reports no findings on changed files
- [x] ADR published at `adr/0005-realtime-sse-over-durable-objects-broker.md`
- [x] Changeset added (`.changeset/realtime-initial.md`)
- [x] Success criteria in spec.md all checkable
- [x] PR #112 links #111
