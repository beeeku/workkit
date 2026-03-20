# Realtime Counter

Durable Object counter with a finite state machine controlling its lifecycle.

## What it demonstrates

- **Typed storage** — `typedStorage<CounterStorage>(state.storage)` gives you type-safe `get()` and `put()` where the key determines the return type. No more `await storage.get('count')` returning `unknown`.
- **State machine** — `createStateMachine` enforces valid state transitions. Trying to `finalize` from `idle` throws a `ValidationError`. The machine exposes `getValidEvents()` so clients know what actions are available.
- **Singleton pattern** — `singleton(env.COUNTER, 'my-counter')` gets a DO stub by name. Each counter name maps to a unique, persistent Durable Object.
- **Hono inside DO** — The Durable Object uses Hono for internal routing, making the DO's API as clean as a regular Worker.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/do` | Typed storage, state machine, singleton helper |
| `@workkit/hono` | Hono integration for the Worker entry point |
| `@workkit/env` | Environment binding validation |
| `@workkit/errors` | ValidationError for invalid state transitions |

## State machine

```
idle ──start──→ counting ──pause──→ paused
                    │                  │
                    │ finalize         │ resume → counting
                    ↓                  │ finalize
                finalized ←────────────┘
```

- `idle` — Counter created but not started
- `counting` — Actively accepting increment/decrement
- `paused` — Temporarily frozen, can resume
- `finalized` — Permanently locked, no further changes

## Running locally

```bash
# Install dependencies
bun install

# Start local dev server
bun run dev
```

## Endpoints

All endpoints are scoped to a named counter: `/counter/:name/...`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/counter/:name` | View current count, state, and valid actions |
| POST | `/counter/:name/start` | Start counting (idle -> counting) |
| POST | `/counter/:name/increment` | Add to counter (body: `{"amount": 5}`) |
| POST | `/counter/:name/decrement` | Subtract from counter |
| POST | `/counter/:name/pause` | Pause counting |
| POST | `/counter/:name/resume` | Resume counting |
| POST | `/counter/:name/finalize` | Lock counter permanently |
| GET | `/counter/:name/history` | View last 100 actions |

## Example usage

```bash
# Create and start a counter
curl -X POST http://localhost:8787/counter/my-counter/start

# Increment
curl -X POST http://localhost:8787/counter/my-counter/increment \
  -H 'Content-Type: application/json' \
  -d '{"amount": 10}'

# Check state
curl http://localhost:8787/counter/my-counter

# Pause, then finalize
curl -X POST http://localhost:8787/counter/my-counter/pause
curl -X POST http://localhost:8787/counter/my-counter/finalize
```
