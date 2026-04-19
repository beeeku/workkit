# 0004. `useChatDebugFrames` package shape — new `@workkit/chat-react` package

Date: 2026-04-19

Tracking issue: [#84](https://github.com/beeeku/workkit/issues/84)
Related: [#82](https://github.com/beeeku/workkit/issues/82) (server-side `onFrameIn` / `onFrameOut` hooks)

## Status

Accepted — implementation help-wanted. Tracked in #84.

## Context

Issue #82 lands server-side frame observability via `onFrameIn` /
`onFrameOut` hooks on `createChatTransport`. That covers what the Worker
sees. It does **not** cover what the browser sees: decode timing on the
client, frames the server drops before the hook fires, the client
reconnect dance, or anything on a consumer's laptop running through
`wrangler tail` they can't read back into a devtools panel.

Downstream consumers already build ad-hoc `ChatDebugPanel` components
with a `DebugFrame` type hand-rolled against `@workkit/chat`'s wire
protocol. That primitive — "ring buffer of typed frames, with connection
state, pluggable into any React tree" — should ship once.

`@workkit/chat` today is Workers-only: `dependencies` are
`@workkit/errors` and `@workkit/types`, no React, no browser code. The
package's `src/index.ts` exports the transport, the DO class, the wire
codec, and the error taxonomy (`packages/chat/src/index.ts`). Adding a
React hook to this package means adding a React peer dep to a package
whose entire value prop today is "runs on Cloudflare Workers, nothing
else."

## Options considered

### (a) `@workkit/chat/react` sub-export

Add a subpath export `./react` with `src/react/index.ts`, peer-dep React
on the `@workkit/chat` package.

- **Pro**: single package to install, one version to track, shared
  `WireMessage` / `DebugFrame` type definitions with zero import
  juggling.
- **Con**: every `@workkit/chat` consumer — including backend-only
  Workers — now has `react` in their `peerDependencies` install graph
  even if tree-shaken out of their bundle. Mixes runtimes at the package
  level, which is the exact split the rest of the monorepo avoids.

### (b) New `@workkit/chat-react` package

New workspace package that `peerDependencies` React ≥18 and
`dependencies` `@workkit/chat` for the wire types.

- **Pro**: matches how the monorepo already splits by runtime concern
  (`@workkit/mail` vs `@workkit/notify`, `@workkit/ai-gateway` vs
  `@workkit/agent`). Workers-only consumers never see React in their
  graph.
- **Con**: a new package is more release overhead — its own changeset
  cadence, its own README, its own `@workkit/testing` wiring.

### (c) Ship only `DebugFrame` / event types from `@workkit/chat`, hook lives in userland

Export the `DebugFrame` discriminated union from `@workkit/chat`'s
existing `src/index.ts`; every consumer writes their own hook.

- **Pro**: zero new package, zero new peer deps, zero runtime
  ship-surface; the type is ~20 lines and gives consumers a shared
  vocabulary.
- **Con**: every consumer re-implements the same ring buffer + socket
  listener + connection-state machine. The whole point of the ticket is
  that this is being re-done in the wild today.

## Decision

**Pick (b): new `@workkit/chat-react` package.**

Two reasons pin this:

1. **Constitution rule 4.** Each package exposes exactly one runtime
   entry. Subpath exports are allowed "when an adapter family clearly
   belongs to the same package" — a React hook is not an adapter of the
   chat transport, it is a *consumer* of it that happens to live in a
   different runtime. A `@workkit/chat/react` subpath would satisfy the
   letter of rule 4 (`src/react/index.ts`) while violating its spirit:
   the package would advertise two runtime stories (Workers server, React
   client) from one npm name.

2. **Runtime-concern separation the monorepo already uses.**
   `@workkit/mail` is the CF primitive; `@workkit/notify` is the
   higher-level consumer and peer-deps mail (ADR 0002, D4).
   `@workkit/ai-gateway` is the client; `@workkit/agent` is the loop that
   uses it. Splitting `chat` (server transport) from `chat-react`
   (browser consumer) follows the same grain.

Option (c) was the strongest rival — type-only shipping is the most
conservative move and genuinely solves the "shared vocabulary" half of
the problem. It was rejected because the ring-buffer + socket-listener +
connection-state machine is not type-shaped; it is runtime behavior that
every consumer is currently rewriting. Shipping only the type leaves the
bug report that opened this ticket unfixed.

## Consequences

### What we commit to

- New workspace folder `packages/chat-react/` with its own
  `package.json`, `src/index.ts`, `README.md`, and `CHANGELOG.md`. Wired
  into `turbo` and the release pipeline like every other package.
- `peerDependencies`: `react >= 18`, `@workkit/chat: workspace:*`.
  `peerDependenciesMeta.react.optional: false` (React is required; the
  package is useless without it).
- `devDependencies` wires `@workkit/testing` per constitution rule 3.
  Test strategy reuses the existing mock-socket helpers — no new mock
  surface invented here.
- Separate release cadence. The hook ships as `0.1.0` independent of
  `@workkit/chat`'s version train; a server-side transport bugfix
  doesn't force a pointless `chat-react` bump.
- `DebugFrame` / `InboundFrameEvent` / `OutboundFrameEvent` types are
  defined in `@workkit/chat` (wire-level, runtime-agnostic) and
  re-exported from `@workkit/chat-react` for ergonomic import. This
  resolves option (c)'s valid point without giving up (b).

### What we explicitly do not commit to

- **No styled UI.** `useChatDebugFrames` is headless. A `DebugPanel`
  component, if we ship one, is unstyled or uses CSS variables only —
  consumers own look and feel. This matches the rest of the workspace
  (we ship zero styled components today).
- **No replay / time-travel.** Out of scope for v1 per the ticket.
- **No production telemetry.** This is a dev tool. Sampling, remote
  shipping, APM integration — caller's concern, not ours.
- **No dev-only guard.** The hook does not introspect
  `process.env.NODE_ENV` or refuse to mount in production. Consumers who
  want that gate it themselves; we are a primitive.

## Proposed minimum viable API

```ts
import { useChatDebugFrames } from "@workkit/chat-react";

const { frames, clear, connectionState } = useChatDebugFrames(socket, {
  bufferSize: 100,
  include: ["message", "error"], // optional filter over DebugFrame["type"]
});
```

- `socket`: a `WebSocket` or `WebSocket`-like with `addEventListener`.
- `frames`: `readonly DebugFrame[]`, newest-last, capped at `bufferSize`.
- `clear()`: drops the buffer.
- `connectionState`: `"connecting" | "open" | "closing" | "closed"`.

No other surface area for v1. Everything else (filtering UI, size-delta
visualization, export) is consumer territory.
