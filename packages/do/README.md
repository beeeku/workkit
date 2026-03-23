# @workkit/do

> Typed Durable Object storage, state machines, alarms, and RPC clients

[![npm](https://img.shields.io/npm/v/@workkit/do)](https://www.npmjs.com/package/@workkit/do)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/do)](https://bundlephobia.com/package/@workkit/do)

## Install

```bash
bun add @workkit/do
```

## Usage

### Before (raw DO API)

```ts
// Untyped storage — any key, any value
export class Counter {
  async fetch(request: Request) {
    const count = (await this.state.storage.get("count")) as number | undefined
    await this.state.storage.put("count", (count ?? 0) + 1)
    return new Response(String((count ?? 0) + 1))
  }
}

// Calling a DO from a Worker — manual fetch, manual JSON parsing
const id = env.COUNTER.idFromName("global")
const stub = env.COUNTER.get(id)
const resp = await stub.fetch(new Request("https://do/increment", {
  method: "POST",
  body: JSON.stringify({ amount: 5 }),
}))
const result = await resp.json()
```

### After (workkit do)

```ts
import { typedStorage, createStateMachine, createDOClient, singleton } from "@workkit/do"

// Typed storage — schema-validated keys and values
const storage = typedStorage<{ count: number; name: string }>(state.storage)
const count = await storage.get("count") // number | undefined
await storage.put("count", 42) // type-checked

// State machine for complex DO logic
const machine = createStateMachine<OrderState, OrderEvent>({
  initial: "pending",
  transitions: {
    pending: { CONFIRM: "confirmed", CANCEL: "cancelled" },
    confirmed: { SHIP: "shipped" },
    shipped: { DELIVER: "delivered" },
  },
})

// RPC-style client — no manual fetch/JSON
interface CounterAPI {
  increment(amount: number): Promise<number>
  getCount(): Promise<number>
}

const counter = createDOClient<CounterAPI>(env.COUNTER, id)
const count = await counter.increment(5) // typed, no fetch boilerplate

// Singleton helper for well-known instances
const globalCounter = singleton<CounterAPI>(env.COUNTER, "global")
```

## API

### Storage

- **`typedStorage<Schema>(storage)`** — Schema-typed wrapper around `DurableObjectStorage`
  - `.get(key)`, `.put(key, value)`, `.delete(key)`, `.list()`, `.transaction(fn)`

### State Machine

- **`createStateMachine<State, Event>(config)`** — Define states, transitions, and side effects

### Alarms

- **`scheduleAlarm(storage, schedule)`** — Schedule a DO alarm
- **`createAlarmHandler(config)`** — Create a typed alarm handler with multiple actions
- **`parseDuration(str)`** — Parse `"1h"`, `"30m"` to milliseconds

### Client Helpers

- **`createDOClient<T>(namespace, id)`** — RPC-style typed client for DO stubs
- **`singleton<T>(namespace, name)`** — Get a named singleton DO instance

### Versioned Storage

- **`versionedStorage<Schema>(raw, options)`** — Wraps `typedStorage` with schema version tracking and forward-only migrations. Runs pending migrations sequentially in a transaction — if any migration fails, the entire transaction rolls back.

```ts
import { versionedStorage } from "@workkit/do"

const store = await versionedStorage<MySchema>(state.storage, {
  version: 3,
  migrations: [
    { from: 1, to: 2, migrate: async (s) => { await s.put("newField", "default") } },
    { from: 2, to: 3, migrate: async (s) => { await s.delete("oldField") } },
  ],
})
```

### Event Sourcing

- **`createEventStore<State, Event>(storage, options)`** — Immutable event log with reducer-based state materialization and periodic snapshots.
  - `.append(event)` — Append an event and return the materialized state
  - `.getState()` — Materialize current state from snapshot + replay
  - `.getEvents(options?)` — Query events with `after` and `limit` pagination
  - `.rebuild()` — Clear snapshots and replay all events from scratch

```ts
import { createEventStore } from "@workkit/do"

const store = createEventStore<OrderState, OrderEvent>(storage, {
  initialState: { status: "pending", items: [] },
  reducer: (state, event) => { /* return new state */ },
  snapshotEvery: 50,
})
await store.append({ type: "item_added", item: { sku: "A1", qty: 2 } })
const state = await store.getState()
```

### Time Series

- **`createTimeSeries<Value>(storage, options)`** — Bucketed metrics aggregation in DO storage with configurable granularity, retention, and custom reducers.
  - `.record(value, at?)` — Record a value into the current time bucket
  - `.query(from, to)` — Query entries in a date range
  - `.rollup(granularity)` — Aggregate fine-grained buckets into `"hour"` or `"day"` rollups
  - `.prune()` — Delete entries older than the retention period. Returns count deleted.

```ts
import { createTimeSeries } from "@workkit/do"

const ts = createTimeSeries(storage, {
  prefix: "api_requests",
  granularity: "minute",
  retention: "7d",
})
await ts.record(1)
const results = await ts.query(hourAgo, now)
const daily = await ts.rollup("day")
const pruned = await ts.prune()
```

## License

MIT
