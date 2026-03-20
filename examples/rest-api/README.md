# REST API

Full CRUD REST API with JWT authentication, D1 database, and Hono framework.

## What it demonstrates

- **Typed API routes** — Define endpoints with Zod validation for request bodies. Invalid input returns structured 422 errors automatically.
- **JWT authentication** — Sign and verify tokens using `@workkit/auth` with WebCrypto (zero dependencies). Supports expiration, issuer, audience claims.
- **D1 query builder** — Fluent `select().where().orderBy().limit()` instead of raw SQL strings. Automatic `snake_case` to `camelCase` column transforms.
- **Structured errors** — `@workkit/errors` provides typed error classes (`NotFoundError`, `UnauthorizedError`, etc.) that serialize to JSON with correct HTTP status codes.
- **Hono integration** — `@workkit/hono` middleware validates env bindings once and caches them. Error handler converts WorkkitErrors to responses.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/hono` | Hono middleware for env validation and error handling |
| `@workkit/env` | Environment binding validation |
| `@workkit/d1` | Typed D1 client with query builder |
| `@workkit/auth` | JWT signing, verification, and token extraction |
| `@workkit/errors` | Structured error classes with HTTP semantics |

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

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Authenticate with email/password, receive JWT |
| GET | `/users` | Yes | List users with pagination |
| GET | `/users/:id` | Yes | Get a single user |
| POST | `/users` | Admin | Create a new user |
| PATCH | `/users/:id` | Yes | Update a user (self or admin) |
| DELETE | `/users/:id` | Admin | Delete a user |
| GET | `/health` | No | Health check |

## Example usage

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"password123"}' | jq -r .token)

# List users
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/users

# Create a user
curl -X POST http://localhost:8787/users \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"new@example.com","name":"New User"}'
```
