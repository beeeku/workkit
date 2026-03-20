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

## License

MIT
