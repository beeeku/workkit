# @workkit/chat

## 0.1.0

### Minor Changes

- New package: Real-time chat transport with typed WebSocket messaging and
  Durable Object sessions. Includes `createChatTransport()` for WebSocket
  upgrade handling, `ChatSessionDO` with message storage and reconnection
  replay, typed protocol (message, typing, error, tool_call, tool_result,
  system), and configurable heartbeat/size limits.
