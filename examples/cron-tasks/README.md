# Cron Tasks

Scheduled tasks with state tracking, distributed locking, and resilience middleware.

## What it demonstrates

- **Named task routing** — `createCronHandler` maps cron patterns to named handler functions. No more `if/else` chains matching `event.cron` strings.
- **Middleware stack** — `withTimeout` kills runaway tasks, `withRetry` handles transient failures. Applied globally or per-task.
- **State tracking** — D1 records each job run with status, duration, and error details. Query `/status` to see recent runs.
- **Distributed locking** — `withLock` uses KV to prevent duplicate execution when multiple Workers handle the same cron trigger.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/cron` | Task routing, cron matching, middleware |
| `@workkit/d1` | Database for job state tracking |
| `@workkit/env` | Environment binding validation |

## Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `cleanup-sessions` | `0 * * * *` (hourly) | Deletes expired sessions older than 24 hours |
| `daily-report` | `0 0 * * *` (midnight) | Aggregates daily user metrics |
| `health-check` | `*/5 * * * *` (5 min) | Pings external endpoints, records latency |

## Running locally

```bash
# Install dependencies
bun install

# Create the local D1 database
bun run db:migrate

# Start local dev server (cron triggers fire automatically)
bun run dev

# Check job run history
curl http://localhost:8787/status
```
