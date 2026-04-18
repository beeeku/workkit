---
title: "Durable Objects"
---

# Durable Objects

`@workkit/do` provides typed storage wrappers, a finite state machine, alarm scheduling/routing, and RPC-style client helpers for Cloudflare Durable Objects.

## Typed Storage

Wrap `DurableObjectStorage` with a schema so get/put/delete are type-checked:

```ts
import { typedStorage } from '@workkit/do'

interface CounterSchema {
  count: number
  lastUpdated: string
  metadata: { owner: string; tags: string[] }
}

export class Counter implements DurableObject {
  private storage: TypedStorageWrapper<CounterSchema>

  constructor(state: DurableObjectState) {
    this.storage = typedStorage<CounterSchema>(state.storage)
  }

  async increment(): Promise<number> {
    const current = await this.storage.get('count') ?? 0
    // current is `number | undefined` -- type-safe

    const next = current + 1
    await this.storage.put('count', next)  // type-checked: must be number
    await this.storage.put('lastUpdated', new Date().toISOString())

    return next
  }
}
```

### Transactions

```ts
const result = await this.storage.transaction(async (txn) => {
  const count = await txn.get('count') ?? 0
  await txn.put('count', count + 1)
  await txn.put('lastUpdated', new Date().toISOString())
  return count + 1
})
```

### List All Keys

```ts
const allData = await this.storage.list()
// Map<string, unknown>
```

### Delete

```ts
const existed = await this.storage.delete('metadata')
// boolean
```

## State Machines

Build finite state machines that persist state via Durable Object storage:

```ts
import { createStateMachine } from '@workkit/do'

// Define states and events
type OrderState = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

type OrderEvent =
  | { type: 'start_processing' }
  | { type: 'ship'; trackingNumber: string }
  | { type: 'deliver' }
  | { type: 'cancel'; reason: string }

const machine = createStateMachine<OrderState, OrderEvent>({
  initial: 'pending',

  transitions: {
    pending: {
      start_processing: 'processing',
      cancel: 'cancelled',
    },
    processing: {
      ship: 'shipped',
      cancel: 'cancelled',
    },
    shipped: {
      deliver: 'delivered',
    },
    // delivered and cancelled have no transitions (terminal states)
  },

  onTransition: async (from, to, event, storage) => {
    // Persist state and log transition
    await storage.put('state', to)
    await storage.put('lastTransition', JSON.stringify({
      from, to, event, timestamp: Date.now(),
    }))
  },
})
```

### Using the Machine

```ts
export class OrderDO implements DurableObject {
  private machine: StateMachine<OrderState, OrderEvent>

  constructor(state: DurableObjectState) {
    this.machine = createStateMachine<OrderState, OrderEvent>({
      initial: 'pending',
      transitions: { /* ... */ },
      onTransition: async (from, to, event, storage) => {
        await storage.put('orderState', to)
      },
    })
  }

  async handleEvent(event: OrderEvent): Promise<OrderState> {
    // Throws ValidationError if transition is invalid
    return await this.machine.send(event, this.state.storage)
  }

  getState(): OrderState {
    return this.machine.getState()
  }

  canShip(): boolean {
    return this.machine.canSend('ship')
  }

  getValidActions(): string[] {
    return this.machine.getValidEvents()
    // e.g., ['start_processing', 'cancel'] when in 'pending'
  }

  reset(): void {
    this.machine.reset()  // back to initial state
  }
}
```

### Invalid Transitions

Attempting an invalid transition throws a `ValidationError`:

```ts
// Machine is in 'pending' state
await machine.send({ type: 'deliver' }, storage)
// ValidationError: Invalid transition: state "pending" does not handle event "deliver".
//   Valid events: [start_processing, cancel]
```

## Alarms

### Scheduling Alarms

```ts
import { scheduleAlarm, parseDuration } from '@workkit/do'

// Schedule relative to now
await scheduleAlarm(state.storage, { in: '5m' })   // 5 minutes from now
await scheduleAlarm(state.storage, { in: '1h' })   // 1 hour from now
await scheduleAlarm(state.storage, { in: '30s' })  // 30 seconds from now

// Schedule at a specific time
await scheduleAlarm(state.storage, { at: new Date('2024-12-31T23:59:59Z') })
await scheduleAlarm(state.storage, { at: Date.now() + 60000 })  // unix ms
```

### Alarm Handler

Route alarms to named action handlers. The action name is stored in DO storage before scheduling:

```ts
import { createAlarmHandler, scheduleAlarm } from '@workkit/do'

const alarmHandler = createAlarmHandler({
  actions: {
    'check-expiry': async (storage) => {
      const expiresAt = await storage.get('expiresAt')
      if (expiresAt && Date.now() > expiresAt) {
        await storage.put('status', 'expired')
      }
    },

    'send-reminder': async (storage) => {
      const userId = await storage.get('userId')
      await sendReminderEmail(userId)
    },

    'cleanup': async (storage) => {
      await storage.deleteAll()
    },
  },

  // Optional: custom storage key for the action name (default: '__alarm_action')
  actionKey: '__alarm_action',
})
```

Wire it up in your Durable Object:

```ts
export class MyDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async scheduleReminder(): Promise<void> {
    // 1. Store the action name
    await this.state.storage.put('__alarm_action', 'send-reminder')
    // 2. Schedule the alarm
    await scheduleAlarm(this.state.storage, { in: '1h' })
  }

  async alarm(): Promise<void> {
    // Routes to the correct action handler and clears the action key
    await alarmHandler.handle(this.state.storage)
  }
}
```

### Duration Parsing

```ts
import { parseDuration } from '@workkit/do'

parseDuration('30s')  // 30000 ms
parseDuration('5m')   // 300000 ms
parseDuration('1h')   // 3600000 ms
parseDuration('2d')   // 172800000 ms
```

## RPC Client

Create a typed RPC-style client for communicating with Durable Objects via fetch:

```ts
import { createDOClient } from '@workkit/do'

// Define the DO's RPC interface
interface CounterAPI {
  increment(amount: number): Promise<number>
  getCount(): Promise<number>
  reset(): Promise<void>
}

// Create a typed client
const id = env.COUNTER.idFromName('global')
const counter = createDOClient<CounterAPI>(env.COUNTER, id)

// Call methods -- fully typed
const count = await counter.increment(5)   // number
const current = await counter.getCount()   // number
await counter.reset()                      // void
```

Each method call sends a POST request to the stub with:
- URL path: the method name (`/increment`)
- Body: JSON-encoded arguments (`[5]`)
- Response: parsed as JSON

Your Durable Object should handle these requests:

```ts
export class Counter implements DurableObject {
  private count = 0

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = url.pathname.slice(1)  // strip leading /
    const args = await request.json() as unknown[]

    switch (method) {
      case 'increment': {
        this.count += args[0] as number
        return Response.json(this.count)
      }
      case 'getCount': {
        return Response.json(this.count)
      }
      case 'reset': {
        this.count = 0
        return Response.json(null)
      }
      default:
        return new Response('Not Found', { status: 404 })
    }
  }
}
```

## Singleton Helper

Get a named Durable Object instance (useful for global singletons):

```ts
import { singleton } from '@workkit/do'

// Get the "global" instance of the RATE_LIMITER DO
const rateLimiter = singleton(env.RATE_LIMITER, 'global')

// Get the "main" instance of the CONFIG DO
const config = singleton(env.CONFIG, 'main')

// These use idFromName() internally, so the same name always returns the same instance
const response = await rateLimiter.fetch(new Request('https://do/check'))
```

## Full Example: Order Processing DO

```ts
import { typedStorage, createStateMachine, scheduleAlarm, createAlarmHandler, createDOClient } from '@workkit/do'

type OrderState = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
type OrderEvent =
  | { type: 'pay' }
  | { type: 'ship'; trackingNumber: string }
  | { type: 'deliver' }
  | { type: 'cancel' }

interface OrderSchema {
  orderId: string
  state: OrderState
  trackingNumber: string | null
  createdAt: number
  __alarm_action: string
}

export class OrderDO implements DurableObject {
  private storage = typedStorage<OrderSchema>(this.state.storage)
  private machine = createStateMachine<OrderState, OrderEvent>({
    initial: 'pending',
    transitions: {
      pending: { pay: 'paid', cancel: 'cancelled' },
      paid: { ship: 'shipped', cancel: 'cancelled' },
      shipped: { deliver: 'delivered' },
    },
    onTransition: async (from, to, event, storage) => {
      await storage.put('state', to)
    },
  })

  private alarmHandler = createAlarmHandler({
    actions: {
      'auto-cancel': async (storage) => {
        const state = await storage.get('state')
        if (state === 'pending') {
          await this.machine.send({ type: 'cancel' }, storage)
        }
      },
    },
  })

  constructor(private state: DurableObjectState, private env: Env) {}

  async initialize(orderId: string): Promise<void> {
    await this.storage.put('orderId', orderId)
    await this.storage.put('state', 'pending')
    await this.storage.put('createdAt', Date.now())

    // Auto-cancel after 24 hours if still pending
    await this.storage.put('__alarm_action', 'auto-cancel')
    await scheduleAlarm(this.state.storage, { in: '1d' })
  }

  async transition(event: OrderEvent): Promise<OrderState> {
    return this.machine.send(event, this.state.storage)
  }

  async alarm(): Promise<void> {
    await this.alarmHandler.handle(this.state.storage)
  }
}

// Client usage from a Worker:
interface OrderAPI {
  initialize(orderId: string): Promise<void>
  transition(event: OrderEvent): Promise<OrderState>
}

const orderId = 'order-123'
const id = env.ORDER.idFromName(orderId)
const order = createDOClient<OrderAPI>(env.ORDER, id)

await order.initialize(orderId)
await order.transition({ type: 'pay' })
await order.transition({ type: 'ship', trackingNumber: 'TRACK-456' })
```

## See also

- [Durable Workflows](/workkit/guides/durable-workflows/) — `@workkit/workflow` is a higher-level abstraction for multi-step durable orchestration; reach for it before hand-rolling a state-machine DO.
- [Approval Workflows](/workkit/guides/approval-workflows/) — uses a per-request DO under the hood for approval state.
