# @workkit/chat

## 0.2.0

### Minor Changes

- 3557072: **Add `onFrameIn` / `onFrameOut` transport hooks for observability (closes #82).**

  `createChatTransport` now accepts two optional hooks on `ChatTransportOptions`:

  - `onFrameIn(event: InboundFrameEvent)` fires at each inbound lifecycle phase:
    `received` (raw frame, pre-decode), `decoded` (parsed `ChatMessage`),
    `handled` (user `onMessage` returned cleanly), and `rejected` (size-limit
    violation, decode failure, or a throw from `onMessage`). `event.error` is
    populated on `rejected`; `event.message` is populated once decoded.
  - `onFrameOut(event: OutboundFrameEvent)` fires for each `ChatMessage` the
    transport writes to the socket with phase `sent` or `send-failed`
    (phase `send-failed` carries the `error`). Heartbeat `ping` frames are not
    `ChatMessage`s and are intentionally not surfaced.

  Hooks are fire-and-forget — a throw (or rejected promise) from either hook is
  swallowed and never crashes the worker or skips downstream transport work,
  matching the existing `onConnect` / `onDisconnect` swallow semantics.

  Two new exported types: `InboundFrameEvent`, `OutboundFrameEvent`.

  No existing public signatures change; all behaviour is opt-in via the new
  hook fields.

## 0.1.0

### Minor Changes

- New package: Real-time chat transport with typed WebSocket messaging and
  Durable Object sessions. Includes `createChatTransport()` for WebSocket
  upgrade handling, `ChatSessionDO` with message storage and reconnection
  replay, typed protocol (message, typing, error, tool_call, tool_result,
  system), and configurable heartbeat/size limits.
