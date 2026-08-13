---
title: "Chat React Debugging"
---

# Chat React Debugging

`@workkit/chat-react` provides headless React hooks for inspecting browser-side `@workkit/chat` WebSocket traffic. Use it to build local debug panels, QA overlays, or support-only diagnostics without coupling your app to a styled component.

The first hook, `useChatDebugFrames`, captures inbound `message` events and outbound `socket.send()` calls while the hook is mounted. It keeps a bounded in-memory frame buffer, parses valid `ChatMessage` payloads, records malformed payloads as `unknown`, and exposes the current socket connection state.

## Install

```bash
bun add @workkit/chat @workkit/chat-react react
```

`@workkit/chat` and `react` are peer dependencies. Keep them installed in the app that renders the hook.

## Basic usage

```tsx
import { useChatDebugFrames } from "@workkit/chat-react";

export function ChatDebugPanel({ socket }: { socket: WebSocket | null }) {
  const { frames, clear, connectionState } = useChatDebugFrames(socket, {
    bufferSize: 100,
    include: ["message", "error", "unknown"],
  });

  return (
    <aside>
      <header>
        <span>Socket: {connectionState}</span>
        <button type="button" onClick={clear}>
          Clear
        </button>
      </header>

      <ol>
        {frames.map((frame) => (
          <li key={frame.id}>
            {frame.direction} {frame.type} {frame.bytes} bytes
          </li>
        ))}
      </ol>
    </aside>
  );
}
```

The hook is UI-agnostic: it returns data only. Render the output into your own development panel, drawer, command palette, or test harness.

## Frame shape

The hook re-exports `DebugFrame` from `@workkit/chat`:

```ts
type DebugFrame = {
  id: string;
  direction: "in" | "out";
  type: ChatMessageType | "unknown";
  timestamp: number;
  bytes: number;
  data: unknown;
  message?: ChatMessage;
  error?: Error;
};
```

Valid `@workkit/chat` envelopes populate `message`. Malformed JSON, invalid message types, and non-string payloads are retained as `unknown` frames so diagnostics can show what the browser actually sent or received.

## Options

```ts
type UseChatDebugFramesOptions = {
  bufferSize?: number;
  include?: readonly (ChatMessageType | "unknown")[];
};
```

| Option | Default | Behavior |
|---|---:|---|
| `bufferSize` | `100` | Maximum frames retained in memory. Invalid values fall back to the default. |
| `include` | all frame types | Optional allowlist for `message`, `typing`, `error`, `tool_call`, `tool_result`, `system`, or `unknown`. |

`frames` are stored oldest-to-newest. When the buffer exceeds `bufferSize`, the oldest frames are dropped.

## Multiple panels on one socket

Multiple `useChatDebugFrames` instances can observe the same socket. The hook installs one shared `send()` wrapper per socket and keeps each hook's recorder isolated, so unmounting one panel does not break another panel or leave `send()` patched after the last panel unmounts.

## Connection state

`connectionState` maps the socket `readyState` into a stable union:

| WebSocket state | Hook value |
|---:|---|
| `0` | `connecting` |
| `1` | `open` |
| `2` | `closing` |
| any other value | `closed` |

The value updates on `open`, `close`, and `error` events. If `socket` is `null` or `undefined`, the hook reports `closed`.

## Production use

The hook does not send diagnostics anywhere by itself. If you expose debug frames in production, gate the rendered panel behind your own authorization checks and avoid showing raw payloads to users who should not see conversation data.

## See also

- [Real-time Chat](/workkit/guides/chat/) - server transport, message envelope, and Durable Object sessions.
- [Realtime](/workkit/guides/realtime/) - SSE broadcast channels for live dashboards and run timelines.
- [Testing](/workkit/guides/testing/) - test utilities and validation patterns for Workkit packages.
