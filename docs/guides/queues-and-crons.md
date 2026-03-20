# Queues and Crons

workkit provides typed queue producers/consumers (`@workkit/queue`) and a cron task router with middleware (`@workkit/cron`) for async background processing.

## Queues

### Producing Messages

```ts
import { queue } from '@workkit/queue'

interface UserEvent {
  type: 'created' | 'updated' | 'deleted'
  userId: string
  timestamp: number
}

const events = queue<UserEvent>(env.USER_EVENTS)

// Send a single message
await events.send({
  type: 'created',
  userId: 'user-123',
  timestamp: Date.now(),
})

// Send with options
await events.send(
  { type: 'updated', userId: 'user-123', timestamp: Date.now() },
  { contentType: 'json' },
)

// Send a batch
await events.sendBatch([
  { body: { type: 'created', userId: 'user-1', timestamp: Date.now() } },
  { body: { type: 'created', userId: 'user-2', timestamp: Date.now() } },
  { body: { type: 'created', userId: 'user-3', timestamp: Date.now() } },
])
```

### Consuming Messages (Per-Message)

`createConsumer` processes each message individually with automatic ack/retry:

```ts
import { createConsumer, RetryAction } from '@workkit/queue'

const handler = createConsumer<UserEvent>({
  async process(message) {
    console.log(`Processing ${message.body.type} for ${message.body.userId}`)
    console.log(`Attempt: ${message.attempts}, ID: ${message.id}`)

    switch (message.body.type) {
      case 'created':
        await sendWelcomeEmail(message.body.userId)
        break  // void return = ack

      case 'updated':
        const success = await syncToExternalSystem(message.body.userId)
        if (!success) return RetryAction.RETRY  // explicit retry
        break

      case 'deleted':
        return RetryAction.DEAD_LETTER  // send to DLQ
    }
    // void return = automatic ack
  },

  // Max retries before DLQ
  maxRetries: 3,

  // Dead letter queue (messages exceeding maxRetries go here)
  deadLetterQueue: env.DLQ,

  // Error handler (optional)
  onError: (error, message) => {
    console.error(`Failed to process ${message.id}:`, error)
  },

  // Filter messages (optional)
  filter: (message) => message.body.type !== 'deleted',
  onFiltered: 'ack',  // 'ack' (default) or 'retry'

  // Concurrency
  concurrency: 5,  // process up to 5 messages in parallel
})

// Wire up in your worker export
export default {
  async queue(batch: MessageBatch<UserEvent>, env: Env) {
    await handler(batch, env)
  },
}
```

### Return Values

The `process` function supports several return values:

```ts
async process(message) {
  return undefined           // void = ack (success)
  return RetryAction.ACK     // explicit ack
  return RetryAction.RETRY   // retry the message
  return RetryAction.DEAD_LETTER  // send to DLQ, then ack
  return { delaySeconds: 30 }     // retry with specific delay
}
```

### Consuming Messages (Batch)

For bulk operations (e.g., batch database inserts):

```ts
import { createBatchConsumer } from '@workkit/queue'

const handler = createBatchConsumer<UserEvent>({
  async processBatch(messages) {
    const events = messages.map(m => m.body)
    await bulkInsertToDatabase(events)
    // All messages acked on success
  },

  retryAll: true,  // on error, retry all messages (default: true)

  onError: (error) => {
    console.error('Batch processing failed:', error)
  },
})
```

### Dead Letter Queue Processing

Process messages that have exhausted retries:

```ts
import { createDLQProcessor } from '@workkit/queue'

const dlqHandler = createDLQProcessor<UserEvent>({
  async process(message, metadata) {
    console.log(`DLQ message from queue: ${metadata.queue}`)
    console.log(`Original attempts: ${metadata.attempts}`)
    console.log(`Message ID: ${metadata.messageId}`)
    console.log(`Timestamp: ${metadata.timestamp}`)

    // Alert on-call
    await sendAlert({
      queue: metadata.queue,
      body: message.body,
      attempts: metadata.attempts,
    })

    // Or store for manual review
    await db.run(
      'INSERT INTO dlq_items (queue, message_id, body, attempts) VALUES (?, ?, ?, ?)',
      [metadata.queue, metadata.messageId, JSON.stringify(message.body), metadata.attempts],
    )
  },
})

export default {
  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === 'my-dlq') {
      await dlqHandler(batch, env)
    } else {
      await mainHandler(batch, env)
    }
  },
}
```

## Crons

### Creating a Cron Handler

Route `scheduled()` events to named task handlers based on cron expressions:

```ts
import { createCronHandler } from '@workkit/cron'

const handler = createCronHandler<Env>({
  tasks: {
    'cleanup-sessions': {
      schedule: '0 */6 * * *',  // every 6 hours
      handler: async (event, env, ctx) => {
        await cleanupExpiredSessions(env.SESSION_KV)
      },
    },
    'sync-data': {
      schedule: '*/15 * * * *',  // every 15 minutes
      handler: async (event, env, ctx) => {
        await syncExternalData(env.DB)
      },
    },
    'daily-report': {
      schedule: '0 9 * * 1-5',  // weekdays at 9 AM
      handler: async (event, env, ctx) => {
        await generateDailyReport(env)
      },
    },
  },

  onNoMatch: async (event, env, ctx) => {
    console.warn(`No task matched cron: ${event.cron}`)
  },
})

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await handler(event, env, ctx)
  },
}
```

### Cron Middleware

Middleware wraps task handlers with cross-cutting concerns. Applied to all tasks:

#### Timeout

```ts
import { createCronHandler, withTimeout } from '@workkit/cron'

const handler = createCronHandler<Env>({
  tasks: { /* ... */ },
  middleware: [
    withTimeout(30000),  // 30 second timeout per task
  ],
})
```

#### Retry

```ts
import { withRetry } from '@workkit/cron'

const handler = createCronHandler<Env>({
  tasks: { /* ... */ },
  middleware: [
    withRetry(3, {
      baseDelay: 1000,
      exponential: true,  // exponential backoff (default)
    }),
  ],
})
```

#### Error Reporting

```ts
import { withErrorReporting } from '@workkit/cron'

const handler = createCronHandler<Env>({
  tasks: { /* ... */ },
  middleware: [
    withErrorReporting(
      (env) => env.ERROR_QUEUE,  // extract error destination from env
      async (error, taskName, event, env) => {
        // Custom error reporter
        await fetch('https://alerts.example.com/webhook', {
          method: 'POST',
          body: JSON.stringify({ task: taskName, error: String(error) }),
        })
      },
    ),
  ],
})
```

#### Combining Middleware

Middleware is applied left-to-right (outermost first):

```ts
const handler = createCronHandler<Env>({
  tasks: { /* ... */ },
  middleware: [
    withErrorReporting((env) => env.ERROR_QUEUE),  // outermost: catches everything
    withTimeout(30000),                             // timeout enforcement
    withRetry(3),                                   // retry on failure
  ],
})
```

### Distributed Locking

Prevent duplicate execution when running multiple Worker instances:

```ts
import { withLock, acquireLock } from '@workkit/cron'

// Wrap a task handler
const lockedHandler = withLock(
  (env) => env.LOCK_KV,          // KV namespace for locks
  'sync-data-lock',              // lock key
  { ttl: 300 },                  // lock TTL in seconds
  async (event, env, ctx) => {
    await syncExternalData(env.DB)
  },
)
// Handler only runs if the lock is acquired.
// Lock is released after completion (or failure).

// Or use acquireLock directly
const lock = await acquireLock(env.LOCK_KV, 'my-task', { ttl: 300 })
if (lock.acquired) {
  try {
    await doWork()
  } finally {
    await lock.release()
  }
} else {
  console.log('Another instance is running this task')
}
```

Note: KV-based locks are best-effort (eventually consistent). They reduce duplicate execution but do not guarantee mutual exclusion. For strict locking, use Durable Objects.

### Cron Expression Utilities

```ts
import { parseCron, describeCron, nextRun, isValidCron, matchCron } from '@workkit/cron'

// Parse a cron expression
const parsed = parseCron('*/15 * * * *')

// Human-readable description
describeCron('0 9 * * 1-5')
// "At 09:00 on Monday through Friday"

// Next scheduled run
const next = nextRun('*/15 * * * *')
// Date

// Validate
isValidCron('*/15 * * * *')  // true
isValidCron('invalid')        // false

// Check if a cron expression matches a trigger
matchCron('*/15 * * * *', '*/15 * * * *')  // true
```

## Full Example: Queue + Cron Pipeline

```ts
import { queue, createConsumer, createDLQProcessor } from '@workkit/queue'
import { createCronHandler, withTimeout, withLock } from '@workkit/cron'
import { d1 } from '@workkit/d1'

interface SyncEvent {
  userId: string
  source: 'api' | 'webhook'
}

export default {
  // HTTP handler: enqueue sync events
  async fetch(request: Request, env: Env) {
    const events = queue<SyncEvent>(env.SYNC_QUEUE)
    const body = await request.json() as SyncEvent
    await events.send(body)
    return new Response('Queued', { status: 202 })
  },

  // Queue consumer: process sync events
  async queue(batch: MessageBatch<SyncEvent>, env: Env) {
    if (batch.queue === 'sync-dlq') {
      return dlqHandler(batch, env)
    }
    return syncHandler(batch, env)
  },

  // Cron: periodic cleanup and reporting
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    return cronHandler(event, env, ctx)
  },
}

const syncHandler = createConsumer<SyncEvent>({
  async process(message) {
    await syncUser(message.body.userId, message.body.source)
  },
  maxRetries: 3,
  deadLetterQueue: env.SYNC_DLQ,
  concurrency: 5,
})

const dlqHandler = createDLQProcessor<SyncEvent>({
  async process(message, metadata) {
    await alertOncall(message.body, metadata)
  },
})

const cronHandler = createCronHandler<Env>({
  tasks: {
    'cleanup-stale-syncs': {
      schedule: '0 */4 * * *',
      handler: withLock(
        (env) => env.LOCK_KV,
        'cleanup-lock',
        { ttl: 600 },
        async (event, env) => {
          const db = d1(env.DB)
          await db.run("DELETE FROM sync_log WHERE created_at < datetime('now', '-7 days')")
        },
      ),
    },
  },
  middleware: [withTimeout(60000)],
})
```
