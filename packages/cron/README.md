# @workkit/cron

> Declarative cron handler with task routing, middleware, and distributed locking

[![npm](https://img.shields.io/npm/v/@workkit/cron)](https://www.npmjs.com/package/@workkit/cron)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/cron)](https://bundlephobia.com/package/@workkit/cron)

## Install

```bash
bun add @workkit/cron
```

## Usage

### Before (raw scheduled handler)

```ts
export default {
  async scheduled(event, env, ctx) {
    // Giant if/else chain matching cron expressions
    if (event.cron === "0 * * * *") {
      await syncUsers(env)
    } else if (event.cron === "*/5 * * * *") {
      await checkHealth(env)
    }
    // No timeout protection, no retry, no locking
  },
}
```

### After (workkit cron)

```ts
import { createCronHandler, withTimeout, withRetry, withLock } from "@workkit/cron"

export default {
  scheduled: createCronHandler({
    middleware: [withTimeout(30_000), withRetry({ maxRetries: 3 })],
    tasks: {
      syncUsers: {
        schedule: "0 * * * *",
        handler: async (event, env, ctx) => {
          await syncUsers(env)
        },
      },
      healthCheck: {
        schedule: "*/5 * * * *",
        handler: withLock(
          { kv: (env) => env.LOCK_KV, key: "health-check" },
          async (event, env, ctx) => {
            await checkHealth(env) // Only one Worker runs this at a time
          },
        ),
      },
    },
  }),
}
```

## API

### Handler

- **`createCronHandler(options)`** — Create a scheduled event handler that routes triggers to matching tasks

### Matching

- **`matchCron(taskSchedule, eventCron)`** — Check if a cron expression matches

### Middleware

- **`withTimeout(ms)`** — Abort tasks that exceed a time limit
- **`withRetry(options)`** — Retry failed tasks with backoff
- **`withErrorReporting(reporter)`** — Report errors to an external service

### Distributed Locking

- **`withLock(options, handler)`** — KV-based lock to prevent concurrent execution
- **`acquireLock(kv, key, options?)`** — Manually acquire a distributed lock

### Parser

- **`parseCron(expression)`** — Parse a cron expression into fields
- **`describeCron(expression)`** — Human-readable description (`"Every 5 minutes"`)
- **`nextRun(expression)`** — Calculate the next run time
- **`isValidCron(expression)`** — Validate a cron expression

### Jitter Middleware

- **`withJitter(maxSeconds)`** — Add random delay before task execution to prevent thundering herd when multiple workers share the same schedule. Delay is uniformly distributed between 0 and `maxSeconds`.

```ts
import { createCronHandler, withJitter } from "@workkit/cron"

export default {
  scheduled: createCronHandler({
    middleware: [withJitter(30)], // random 0-30s delay
    tasks: { syncUsers: { schedule: "0 * * * *", handler: syncUsers } },
  }),
}
```

### Cron Builder

- **`cron()`** — Fluent cron expression builder. Chain `.every(n?)` or `.on()` with time units and `.build()` to produce a valid cron string.

```ts
import { cron } from "@workkit/cron"

cron().every(5).minutes().build()          // "*/5 * * * *"
cron().every().day().at(9).build()         // "0 9 * * *"
cron().on().monday().at(14, 30).build()    // "30 14 * * 1"
cron().every().weekday().at(8).build()     // "0 8 * * 1-5"
```

### Task Dependencies

- **`after: ['taskName']`** — Declare dependencies between tasks. Tasks are topologically sorted and executed in dependency order. Dependent tasks are skipped if a dependency fails. Circular dependencies throw a `ValidationError`.

```ts
import { createCronHandler } from "@workkit/cron"

export default {
  scheduled: createCronHandler({
    tasks: {
      fetchData: { schedule: "0 * * * *", handler: fetchHandler },
      transform: { schedule: "0 * * * *", handler: transformHandler, after: ["fetchData"] },
      publish:   { schedule: "0 * * * *", handler: publishHandler, after: ["transform"] },
    },
  }),
}
```

## License

MIT
