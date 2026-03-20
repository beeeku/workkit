# Full-Stack App

Complete task management API combining env, d1, kv, auth, cache, ratelimit, and hono.

## What it demonstrates

This example brings together most workkit packages into a single, production-quality application. It shows how the packages compose naturally without conflicts or boilerplate.

- **Environment validation** — All bindings (D1, KV, secrets) validated once at startup with `@workkit/env`
- **JWT auth with session caching** — `@workkit/auth` handles JWT sign/verify and password hashing. Sessions are cached in KV (`@workkit/kv`) for faster subsequent requests.
- **D1 query builder** — `@workkit/d1` provides fluent queries with `select().where().andWhere().orderBy()`. The `camelCase` transform handles `snake_case` columns automatically.
- **Rate limiting** — `@workkit/ratelimit` with fixed window per IP. Standard headers added to every response.
- **SWR caching** — Dashboard stats and list counts use `@workkit/cache`'s stale-while-revalidate pattern. Users see instant results while fresh data loads in the background.
- **Structured errors** — `@workkit/errors` provides `NotFoundError`, `ConflictError`, `UnauthorizedError`, etc. The Hono error handler converts them to JSON responses with correct HTTP status codes.
- **Password security** — `@workkit/auth`'s `hashPassword`/`verifyPassword` uses PBKDF2 via WebCrypto. No external dependencies.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/hono` | Hono middleware and error handler |
| `@workkit/env` | Environment binding validation |
| `@workkit/d1` | Typed D1 client with query builder |
| `@workkit/kv` | Typed KV client for session caching |
| `@workkit/auth` | JWT, password hashing, token extraction |
| `@workkit/cache` | Stale-while-revalidate for stats |
| `@workkit/ratelimit` | Fixed window rate limiting |
| `@workkit/errors` | Structured error classes |
| `@workkit/api` | Typed route definitions |

## Running locally

```bash
# Install dependencies
bun install

# Create and seed the local D1 database
bun run db:migrate

# Start local dev server
bun run dev
```

## Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login, receive JWT |

### Tasks (all require auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (filterable by status, priority) |
| GET | `/api/tasks/:id` | Get a single task |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| GET | `/api/stats` | Dashboard stats (cached) |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

## Example usage

```bash
# Register
curl -X POST http://localhost:8787/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","name":"Dev","password":"secure-password-123"}'

# Login
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"secure-password-123"}' | jq -r .token)

# Create a task
curl -X POST http://localhost:8787/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Ship workkit v1","priority":"high","dueDate":"2025-04-01"}'

# List tasks filtered by priority
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8787/api/tasks?priority=high"

# Get dashboard stats
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/stats
```

## Architecture notes

- **Session caching**: JWT verification is done once, then the session is cached in KV with a 5-minute TTL. This reduces crypto operations on subsequent requests while keeping sessions short-lived.
- **SWR for counts**: Total counts for pagination and dashboard stats use `swr()` with a 30-second TTL and 10-minute stale window. Users always get a number instantly; the count refreshes in the background.
- **Rate limiting**: Applied per-IP at 60 requests/minute on all `/api/*` routes. Rate limit headers are attached to every response so clients can self-regulate.
