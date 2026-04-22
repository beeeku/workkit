# Feature: @workkit/realtime — SSE-over-Durable-Objects broadcast primitive

Tracks: #111

## Problem Statement

Cloudflare Workers isolates are ephemeral — a subscriber connected to isolate A cannot receive an event published from isolate B, because no cross-isolate in-memory state exists. The only way to hold a shared subscriber list across a Worker deployment is a Durable Object.

Today `packages/notify/src/adapters/inapp/sse.ts:11` already ships a single-isolate SSE helper and explicitly defers multi-isolate fan-out to *"a future Durable-Object-backed adapter"*. That adapter is this package.

Without this primitive, every Workkit-built app that needs live UI (maina-cloud dashboard, `maina run follow`, future deploy dashboard) re-solves the same DO + SSE + reconnect + replay problem. Consolidating into one tested package removes that duplication and gives a single back-compat story for DO bindings + migrations.

## Target User

- **Primary:** Workers application developers who need live UI updates and already use other `@workkit/*` primitives. First consumer: `mainahq/maina-cloud` dashboard-v1 (spec: `mainahq/maina-cloud/.maina/specs/001-dashboard-v1/realtime.md`).
- **Secondary:** CLI consumers (`mainahq/maina` — `maina run follow <runId>`) using the client helper in a Node context (no `EventSource` dependency — the client is `fetch`+stream based).

## User Stories

- As a Worker handler, I want to publish an event to a channel with one call and have every active subscriber receive it within ~100ms.
- As a browser client, I want to subscribe to a channel (via the package's `fetch`+stream client), survive a network drop, and replay missed events on reconnect via `Last-Event-ID`.
- As the app owner, I want to reject unauthorized subscribes via a per-request hook that sees the channel name, the `Request`, and the `Env`.
- As an operator, I want connections behind an SSE-stripping proxy to fall back to polling without client code changes.

## Success Criteria

- [ ] `createBroker({ authorize, replayBufferSize })` returns a DO class that handles `POST /publish` and `GET /subscribe?channel=<name>` on its stub fetch.
- [ ] `publish(namespace, channel, event, data)` fans out to every active subscriber of `channel` with a monotonic `id:` within one DO RPC.
- [ ] `authorize()` returning `null` produces HTTP 403 on the subscribe response; a thrown error is treated as deny.
- [ ] Reconnect with `Last-Event-ID: N` replays every buffered event with `id > N` in order before resuming live delivery, bounded by `replayBufferSize`.
- [ ] `subscribe(url, opts)` (client) reconnects with exponential backoff, persists `lastEventId` across reconnects, and calls `fallbackToPolling` after `opts.pollingAfterMs` of continuous failures.
- [ ] Broker survives zero-subscriber idle: DO evicts, next subscribe re-creates; callers see no error.
- [ ] Package passes `bun run constitution:check` (including the `@workkit/testing` wiring rule).
- [ ] Unit + integration test coverage: framing, ring buffer, broker state, publish, client reconnect, authorize.

## Scope

### In Scope (v1)

- DO broker factory with per-channel fan-out, keyed by channel name via `singleton(namespace, channel)`.
- SSE line framing (`event:`, `id:`, `data:`, heartbeat `:`).
- In-memory ring buffer per channel (LRU-trimmed to `replayBufferSize`).
- `Last-Event-ID` replay on subscribe.
- Per-channel `authorize(channel, request, env)` hook.
- Browser client: `subscribe(url, opts)` with backoff + `Last-Event-ID` persistence + optional polling fallback URL.
- Test harness: broker unit tests via `createMockDO`; framing + ring buffer are pure.

### Out of Scope (v1)

- **WebSocket transport** — SSE + polling fallback covers maina's surface; WebSocket belongs in v2 and earns a new ADR.
- **Cross-region persistence** — DO storage write on every publish inverts the fire-and-forget contract. If the DO evicts, replay is lost; reload is the documented recovery.
- **At-least-once delivery** — not guaranteed. Delivery is best-effort + bounded replay.
- **Presence / member lists** — future; not required for the first-consumer surface.
- **Channel schemas or typed event validation** — callers stringify their own payloads.
- **Built-in auth provider** — we expose the hook; we don't ship cookie parsing, JWT, etc.

## Design Decisions

### 1. Per-channel DO (not sharded multi-channel)
Workers bills per request, not per idle DO instance; hibernation + eviction make sparse channels effectively free. Sharding adds a routing table with zero scale benefit at current usage. **Rejected alternative:** one DO hosting many channels — added complexity for no measurable win.

### 2. Explicit `DurableObjectNamespace` arg, not env-convention
`publish(namespace, channel, event, data)` mirrors `singleton(namespace, name)` from `@workkit/do`. Apps may run multiple brokers under different auth scopes; a convention like `env.SSE_BROKER` hides that flexibility. **Rejected alternative:** `publish(env, channel, ...)` with hard-coded binding name.

### 3. In-memory ring buffer (not DO storage)
Storage-backed replay turns every publish into a write — inverts the ephemeral contract and blows up cost. SSE's own reconnect model accepts "reload on long disconnect." Matches the issue's explicit direction. **Rejected alternative:** persistent replay log.

### 4. Subpath exports: `@workkit/realtime` + `@workkit/realtime/client`
Constitution rule #4 requires a single `src/index.ts`; subpaths via the `exports` map keep server code out of the browser bundle and vice versa.

### 5. Duplicate 20-line SSE framing, don't extract
`@workkit/notify` has its own private framing. A third micro-package just to share ~20 lines is premature abstraction. Duplicate now; extract if a third caller shows up. Matches the "three similar lines beats premature abstraction" rule.

### 6. New package, not an adapter in `@workkit/notify`
Notify is *deliver-to-user* (retryable, provider-backed). Realtime is *broadcast-to-topic* (fire-and-forget, ephemeral). Different failure model, different consumer (UI vs. domain code), different future (realtime earns WebSocket; notify earns more providers). Merging would muddy both.

## Open Questions

- **Max concurrent subscribers per channel** — SSE on DO can't hibernate an active response stream, so each subscriber holds the DO awake. Do we enforce a cap? *Proposed:* soft cap at 1000/channel, configurable, 429 beyond. Resolve before implement.
- **Heartbeat cadence default** — notify uses 30s. Same default here? *Proposed:* yes, match.
- **Channel name validation** — regex or free-form string? *Proposed:* `^[a-zA-Z0-9:_.-]{1,128}$` to prevent path traversal in the subscribe URL.
