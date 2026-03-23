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

### Circuit Breaker

- **`withCircuitBreaker<Body>(consumer, options)`** — Wrap a consumer handler with three-state fault tolerance. Tracks failure rates in KV and short-circuits when a downstream dependency is failing.
  - **Closed** — normal operation, failures counted. Opens at `failureThreshold`.
  - **Open** — all messages retried. Transitions to half-open after `resetTimeout`.
  - **Half-Open** — allows `halfOpenMax` probe messages. Success closes, failure re-opens.

```ts
import { withCircuitBreaker, createConsumer } from "@workkit/queue"

const handler = withCircuitBreaker<UserEvent>(myConsumer, {
  namespace: env.CIRCUIT_KV,
  key: "downstream-api",
  failureThreshold: 5,
  resetTimeout: "30s",
  halfOpenMax: 1,
})
```

### Workflow Primitives

- **`createWorkflow<Body, Context>(options)`** — Linear step chains with context carrythrough and rollback. Each step receives the message body and accumulated context, returning partial context merged forward. On failure, completed steps roll back in reverse order.

```ts
import { createWorkflow } from "@workkit/queue"

const handler = createWorkflow<OrderEvent, { validated?: boolean; charged?: boolean }>({
  steps: [
    { name: "validate", process: async (body, ctx) => ({ validated: true }), rollback: async (body) => { /* undo */ } },
    { name: "charge", process: async (body, ctx) => ({ charged: true }), rollback: async (body) => { /* refund */ } },
  ],
  onComplete: async (body, ctx) => { await notify(body.orderId) },
})
```

### DLQ Analyzer

- **`createDLQAnalyzer<Body>(options)`** — Aggregate failure patterns from dead letter queues. Records failures to KV-backed counters with per-queue breakdowns, hourly histograms, and error pattern grouping.
  - `.record(message, metadata, error?)` — Record a DLQ failure
  - `.summary()` — Get total counts, per-queue breakdown, hourly histogram, and top errors
  - `.topErrors(limit?)` — Get the most frequent error patterns

```ts
import { createDLQAnalyzer } from "@workkit/queue"

const analyzer = createDLQAnalyzer<UserEvent>({
  namespace: env.DLQ_KV,
  prefix: "user-events",
})
await analyzer.record(message, metadata, error)
const summary = await analyzer.summary()   // { total, byQueue, byHour, topErrors }
const top = await analyzer.topErrors(5)
```

## License

MIT
