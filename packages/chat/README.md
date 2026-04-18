# @workkit/chat

> Real-time chat over WebSockets for Cloudflare Workers — typed envelopes, heartbeats, optional Durable Object sessions with hibernation.

[![npm](https://img.shields.io/npm/v/@workkit/chat)](https://www.npmjs.com/package/@workkit/chat)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/chat)](https://bundlephobia.com/package/@workkit/chat)

Two modes: stateless transport (`createChatTransport`) for proxies/echoes, and `ChatSessionDO` for persistent sessions with reconnect replay. Both share the same `ChatMessage` envelope and `onMessage` handler signature.

## Install

```bash
bun add @workkit/chat
```

## Usage — stateless transport

```ts
import { createChatTransport } from "@workkit/chat";

const transport = createChatTransport({
  onMessage: async (sessionId, msg) => ({
    id: crypto.randomUUID(),
    type: "message",
    role: "assistant",
    content: `Echo: ${msg.content}`,
    timestamp: Date.now(),
  }),
});

export default {
  async fetch(req: Request) {
    const sessionId = new URL(req.url).searchParams.get("sessionId") ?? crypto.randomUUID();
    return transport.handleUpgrade(req, sessionId);
  },
};
```

## Usage — Durable Object sessions

```ts
import { ChatSessionDO } from "@workkit/chat";
export { ChatSessionDO };

export default {
  async fetch(req: Request, env: Env) {
    const sessionId = new URL(req.url).searchParams.get("sessionId") ?? crypto.randomUUID();
    const id = env.CHAT_DO.idFromName(sessionId);
    return env.CHAT_DO.get(id).fetch(req);
  },
};
```

The DO uses WebSocket hibernation, persists up to `maxStoredMessages` (default 100) for reconnect replay via `?lastMessageId=<id>`.

## Highlights

- Typed `ChatMessage` envelope with `message | typing | error | tool_call | tool_result | system` discriminant
- Configurable heartbeat (default 30s) and max message size (default 64 KB)
- WebSocket hibernation in DO mode — connections survive Worker restarts
- Reconnect message replay
- Wire codec exposed via `encodeMessage` / `decodeMessage`

## Documentation

Full guide: [workkit docs — Real-time Chat](https://beeeku.github.io/workkit/guides/chat/)
