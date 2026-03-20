# @workkit/queue

> Typed queue producer and consumer with retry strategies and dead letter support

[![npm](https://img.shields.io/npm/v/@workkit/queue)](https://www.npmjs.com/package/@workkit/queue)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/queue)](https://bundlephobia.com/package/@workkit/queue)

## Install

```bash
bun add @workkit/queue
```

## Usage

### Before (raw Queue API)

```ts
// No type safety on message bodies
await env.MY_QUEUE.send({ type: "user.created", userId: "123" }) // any

// Consumer requires manual ack/retry logic
export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await processMessage(msg.body) // untyped
        msg.ack()
      } catch {
        msg.retry() // no delay control
      }
    }
  },
}
```

### After (workkit queue)

```ts
import { queue, createConsumer, createBatchConsumer, RetryAction } from "@workkit/queue"

type UserEvent = { type: "created" | "deleted"; userId: string }

// Typed producer
const events = queue<UserEvent>(env.USER_EVENTS)
await events.send({ type: "created", userId: "123" }) // type-checked
await events.sendBatch([
  { body: { type: "created", userId: "456" } },
  { body: { type: "deleted", userId: "789" } },
])

// Typed consumer with automatic ack/retry
export default {
  queue: createConsumer<UserEvent>({
    async handler(message) {
      await processUser(message.body) // typed as UserEvent
      // Auto-acked on success. Return RetryAction to retry:
      // return RetryAction.retry()
      // return RetryAction.retryAfter(30) // delay in seconds
    },
    maxRetries: 3,
  }),
}

// Batch consumer for high-throughput
export default {
  queue: createBatchConsumer<UserEvent>({
    async handler(messages) {
      await bulkProcess(messages.map((m) => m.body))
    },
  }),
}
```

## API

### Producer

- **`queue<T>(binding)`** — Create a typed queue producer
  - `.send(body, opts?)` — Send a single message
  - `.sendBatch(messages, opts?)` — Send multiple messages
  - `.raw` — Access the underlying queue binding

### Consumer

- **`createConsumer<T>(options)`** — Per-message consumer with auto ack/retry
- **`createBatchConsumer<T>(options)`** — Batch consumer for bulk processing

### Retry

- **`RetryAction.retry()`** — Retry immediately
- **`RetryAction.retryAfter(seconds)`** — Retry after delay

### Dead Letter Queue

- **`createDLQProcessor(options)`** — Process messages from a dead letter queue

## License

MIT
