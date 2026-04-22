# workkit

[![CI](https://github.com/beeeku/workkit/actions/workflows/ci.yml/badge.svg)](https://github.com/beeeku/workkit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/workkit?label=npm)](https://www.npmjs.com/org/workkit)

> Composable utilities for Cloudflare Workers. Think TanStack for Workers.

Every package wraps a Cloudflare binding or API with type safety, better DX, and sensible defaults. Use one package or all of them -- they're independent, tree-shakeable, and designed to compose.

## Packages

| Package | Description |
|---------|-------------|
| [`@workkit/types`](packages/types) | Shared TypeScript types for bindings, handlers, and utilities |
| [`@workkit/errors`](packages/errors) | Structured, retryable error classes with HTTP mapping |
| [`@workkit/env`](packages/env) | Type-safe env validation using Standard Schema (Zod, Valibot, ArkType) |
| [`@workkit/kv`](packages/kv) | Typed KV client with serialization, batching, and key prefixing |
| [`@workkit/d1`](packages/d1) | Typed D1 client with query builder and classified errors |
| [`@workkit/r2`](packages/r2) | Typed R2 client with streaming, multipart uploads, and presigned URLs |
| [`@workkit/cache`](packages/cache) | Cache API wrapper with SWR, cache-aside, and tagged invalidation |
| [`@workkit/queue`](packages/queue) | Typed queue producer/consumer with retry, DLQ, circuit breaker, and workflow primitives |
| [`@workkit/do`](packages/do) | Typed DO storage, state machines, alarms, event sourcing, and time-series aggregations |
| [`@workkit/cron`](packages/cron) | Declarative cron handler with task routing, dependencies, fluent builder, and jitter |
| [`@workkit/ratelimit`](packages/ratelimit) | KV-backed rate limiting (fixed/sliding/token bucket), tiered limits, and quota tracking |
| [`@workkit/crypto`](packages/crypto) | AES-256-GCM encryption, digital signatures, key rotation, AAD, and random utilities |
| [`@workkit/ai`](packages/ai) | Typed Workers AI client with streaming, fallback chains, and retry |
| [`@workkit/ai-gateway`](packages/ai-gateway) | Multi-provider AI gateway — Workers AI, OpenAI, Anthropic, custom. Routing, streaming, fallback, retry, prompt caching, Cloudflare AI Gateway routing, cost tracking |
| [`@workkit/api`](packages/api) | Type-safe API definitions with Standard Schema and OpenAPI generation |
| [`@workkit/realtime`](packages/realtime) | SSE-over-Durable-Objects broadcast primitive — per-channel pub/sub with Last-Event-ID replay and a fetch-based client wrapper |
| [`@workkit/logger`](packages/logger) | Structured logging with request context and Hono middleware |
| [`@workkit/auth`](packages/auth) | JWT, session management, and auth middleware |
| [`@workkit/testing`](packages/testing) | In-memory mocks with operation tracking, seed builders, error injection, and snapshots |

### Integrations

| Package | Description |
|---------|-------------|
| [`@workkit/hono`](integrations/hono) | Hono middleware for env validation, error handling, rate limiting, tiered limits, quotas, and caching |
| [`@workkit/astro`](integrations/astro) | Astro middleware and helpers for Cloudflare bindings |
| [`@workkit/remix`](integrations/remix) | Typed Remix loaders and actions with env validation |

## CLI

Scaffold projects, validate bindings, run migrations, and generate code. The CLI supports interactive mode -- run any command without arguments for guided prompts.

```bash
bunx workkit init --template hono --features env,d1
```

| Command | Description |
|---------|-------------|
| `workkit init` | Scaffold a new Workers project |
| `workkit add` | Add packages to an existing project (interactive multi-select) |
| `workkit check` | Validate bindings against env schema |
| `workkit d1 migrate` | Run D1 migrations |
| `workkit d1 seed` | Seed D1 from fixture files |
| `workkit gen client` | Generate typed API client from route definitions |
| `workkit gen docs` | Generate OpenAPI docs from route definitions |
| `workkit catalog` | Show available packages and their status |

## Quick Start

**1. Install what you need**

```bash
bun add @workkit/env @workkit/kv @workkit/errors
```

**2. Validate your environment**

```ts
import { parseEnvSync } from "@workkit/env"
import { z } from "zod"

const env = parseEnvSync(rawEnv, {
  API_KEY: z.string().min(1),
  CACHE: z.any(),
})
// env.API_KEY — string (validated)
```

**3. Use typed bindings**

```ts
import { kv } from "@workkit/kv"

const cache = kv<User>(env.CACHE, { prefix: "user:", defaultTtl: 3600 })
const user = await cache.get("alice") // User | null
```

## Philosophy

- **Composable, not monolithic.** Each package solves one thing. Use what you need, ignore the rest.
- **Types over docs.** APIs are designed so TypeScript tells you what to do. If you need to read docs, the types failed.
- **Standard Schema.** Validation uses the [Standard Schema](https://github.com/standard-schema/standard-schema) spec -- bring Zod, Valibot, ArkType, or any compatible library.
- **Zero runtime overhead.** Thin wrappers that add type safety and DX without performance cost. No ORMs, no heavy abstractions.

## License

MIT
