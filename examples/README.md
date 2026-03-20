# workkit examples

Real-world, runnable example projects demonstrating how to use workkit packages to build Cloudflare Workers.

## Examples

| Example | Description | Packages |
|---------|-------------|----------|
| [basic-worker](./basic-worker/) | Minimal fetch handler with environment validation | env, kv |
| [rest-api](./rest-api/) | Full CRUD REST API with JWT auth and D1 database | api, hono, d1, auth, errors, env |
| [queue-worker](./queue-worker/) | Queue producer/consumer with dead letter queue | queue, errors, env |
| [cron-tasks](./cron-tasks/) | Scheduled tasks with state tracking and middleware | cron, d1, env |
| [ai-chatbot](./ai-chatbot/) | Streaming AI chatbot with rate limiting and caching | ai, ratelimit, cache, hono, env |
| [file-upload](./file-upload/) | R2 file management with presigned URLs | r2, auth, hono, errors, env |
| [realtime-counter](./realtime-counter/) | Durable Object counter with state machine | do, hono, env, errors |
| [full-stack](./full-stack/) | Complete task management app combining 9 packages | env, d1, kv, auth, cache, ratelimit, hono, errors, api |

## Getting started

Each example is a standalone Cloudflare Worker project. To run any example:

```bash
cd examples/<example-name>

# Install dependencies (from the monorepo root, or in the example directory)
bun install

# Start local development server
bun run dev
```

Examples that use D1 databases include a `schema.sql` file. Run the migration before starting:

```bash
bun run db:migrate
```

## Package coverage

Every workkit package is demonstrated in at least one example:

| Package | Used in |
|---------|---------|
| `@workkit/env` | All examples |
| `@workkit/errors` | rest-api, queue-worker, file-upload, realtime-counter, full-stack |
| `@workkit/hono` | rest-api, ai-chatbot, file-upload, realtime-counter, full-stack |
| `@workkit/d1` | rest-api, cron-tasks, full-stack |
| `@workkit/kv` | basic-worker, full-stack |
| `@workkit/auth` | rest-api, file-upload, full-stack |
| `@workkit/cache` | ai-chatbot, full-stack |
| `@workkit/ratelimit` | ai-chatbot, full-stack |
| `@workkit/queue` | queue-worker |
| `@workkit/cron` | cron-tasks |
| `@workkit/ai` | ai-chatbot |
| `@workkit/r2` | file-upload |
| `@workkit/do` | realtime-counter |
| `@workkit/api` | rest-api, full-stack |

## Conventions

- All examples use `workspace:*` for `@workkit/*` dependencies, making them work within the monorepo
- Each example has a `wrangler.toml` with appropriate bindings pre-configured
- TypeScript with strict mode and `@cloudflare/workers-types`
- Zod is used for request validation (any Standard Schema provider works)
- Code includes BEFORE/AFTER comments showing raw Cloudflare API vs. workkit equivalents
