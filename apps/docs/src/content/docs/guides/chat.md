---
title: "Real-time Chat"
---

# Real-time Chat

`@workkit/chat` is a WebSocket-based chat transport for Cloudflare Workers — typed message envelopes, heartbeats, message-size limits, optional Durable Object sessions with hibernation and replay. Use it as the runtime for AI assistants, support widgets, multi-user channels, or any low-latency messaging surface on Workers.

## Install

```bash
bun add @workkit/chat
```

## Two ways to run it

| Mode | When to use |
|---|---|
| `createChatTransport()` — stateless | Echo / proxy / serverless adapter where conversation state lives elsewhere |
| `ChatSessionDO` — DO-backed | Persistent sessions with reconnect replay (chat windows, ongoing AI conversations) |

Both share the same wire protocol (`ChatMessage` envelope) and `onMessage` handler signature.

## Quick start — stateless transport

```ts
import { createChatTransport } from "@workkit/chat";

const transport = createChatTransport({
  onMessage: async (sessionId, msg) => {
    if (msg.type !== "message") return undefined;
    return {
      id: crypto.randomUUID(),
      type: "message",
      role: "assistant",
      content: `Echo: ${msg.content}`,
      timestamp: Date.now(),
    };
  },
  heartbeatInterval: 30_000,
  maxMessageSize: 65_536,
});

export default {
  async fetch(req: Request) {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const sessionId = new URL(req.url).searchParams.get("sessionId") ?? crypto.randomUUID();
    return transport.handleUpgrade(req, sessionId);
  },
};
```

The transport upgrades to a WebSocket, sends `{"type":"ping"}` every `heartbeatInterval` ms, and rejects messages over `maxMessageSize` bytes with a typed `error` envelope. `onMessage` may return `undefined`, a single `ChatMessage`, or a `ChatMessage[]` for fan-out.

## Durable-Object sessions

Cloudflare instantiates DOs with `(state, env)` only — the third `options` arg the base class accepts isn't reachable from a `wrangler.toml` binding. **Subclass and call `super(state, env, { onMessage })` from the constructor** so your handler is wired up:

```ts
import { ChatSessionDO, type ChatMessage } from "@workkit/chat";

export class ChatDO extends ChatSessionDO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      onMessage: async (sessionId, msg): Promise<ChatMessage | undefined> => {
        if (msg.type !== "message") return undefined;
        return {
          id: crypto.randomUUID(),
          type: "message",
          role: "assistant",
          content: `Echo: ${msg.content}`,
          timestamp: Date.now(),
        };
      },
      maxStoredMessages: 100,
    });
  }
}

export default {
  async fetch(req: Request, env: Env) {
    const sessionId = new URL(req.url).searchParams.get("sessionId") ?? crypto.randomUUID();
    const id = env.CHAT_DO.idFromName(sessionId);
    return env.CHAT_DO.get(id).fetch(req);
  },
};
```

Without the constructor override, `ChatSessionDO` falls back to a no-op `onMessage` and incoming messages will be silently dropped.

The DO uses [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/api/websockets/) — your connection survives Worker restarts and CPU limits. Messages are persisted in DO storage (capped by `maxStoredMessages`, default 100) so reconnects can replay missed messages by passing `?lastMessageId=<id>`.

`ChatSessionDOOptions`:

```ts
type ChatSessionDOOptions = {
  onMessage: (sessionId: string, msg: ChatMessage) =>
    Promise<ChatMessage | ChatMessage[] | undefined>;
  maxStoredMessages?: number;  // default 100
  maxMessageSize?: number;     // default 65_536
};
```

## Message envelope

```ts
type ChatMessageType = "message" | "typing" | "error" | "tool_call" | "tool_result" | "system";

interface ChatMessage {
  id: string;
  type: ChatMessageType;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

`encodeMessage()` / `decodeMessage()` are exported for callers that need to wrap their own transports. `createMessageId()` returns a sortable id you can store as `lastMessageId` to drive reconnect replay.

## Errors

`ChatError` carries a discriminated `code: ChatErrorCode` for protocol violations (oversized payloads, malformed envelopes). Inside the transport these become typed `error` messages on the wire — the connection stays open so the client can recover.

## See also

- [Agents](/workkit/guides/agents/) — wire `onMessage` to an `@workkit/agent` loop for AI chat backends.
- [Durable Objects](/workkit/guides/durable-objects/) — `@workkit/do` patterns underpin `ChatSessionDO`.
- [Notifications](/workkit/guides/notifications/) — pair with `@workkit/notify/inapp` for offline delivery.
