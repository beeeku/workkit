# @workkit/chat-react

Headless React debugging hooks for `@workkit/chat` WebSocket transports.

```ts
import { useChatDebugFrames } from "@workkit/chat-react";

const { frames, clear, connectionState } = useChatDebugFrames(socket, {
	bufferSize: 100,
	include: ["message", "error"],
});
```

`useChatDebugFrames` observes incoming `message` events and wraps `socket.send`
while mounted so client-side development panels can inspect the browser-side
frame stream. The hook is headless and does not ship styled UI.
