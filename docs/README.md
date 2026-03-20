# workkit Documentation

A composable, tree-shakeable toolkit for building type-safe Cloudflare Workers.

## Getting Started

- [Getting Started](./getting-started.md) -- Installation, first worker, key concepts

## Architecture

- [Architecture](./architecture.md) -- Package layers, dependency graph, design philosophy

## Guides

- [Environment Validation](./guides/env-validation.md) -- Validate env bindings with Zod, Valibot, or ArkType
- [Database (D1)](./guides/database.md) -- Typed queries, migrations, batch operations
- [KV Patterns](./guides/kv-patterns.md) -- Caching, sessions, feature flags, serialization
- [Authentication](./guides/authentication.md) -- JWT, sessions, password hashing, middleware
- [Rate Limiting](./guides/rate-limiting.md) -- Fixed window, sliding window, token bucket, composite
- [AI Integration](./guides/ai-integration.md) -- Workers AI, AI Gateway, streaming, fallbacks, cost tracking
- [Testing](./guides/testing.md) -- Mock bindings, integration patterns, vitest setup
- [Error Handling](./guides/error-handling.md) -- Structured errors, retry logic, HTTP mapping
- [Queues and Crons](./guides/queues-and-crons.md) -- Queue processing, cron scheduling, dead letter queues
- [Durable Objects](./guides/durable-objects.md) -- State machines, typed storage, alarms, RPC

## Reference

- [API Reference](./api-reference.md) -- All exported functions and types per package
- [Migration Guide](./migration.md) -- Migrating from raw Cloudflare APIs to workkit
- [Contributing](./contributing.md) -- Monorepo structure, running tests, adding packages
