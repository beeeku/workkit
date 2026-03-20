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

## License

MIT
