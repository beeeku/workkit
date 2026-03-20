/**
 * Realtime Counter — Durable Object with state machine and Hono routing
 *
 * Demonstrates building stateful Workers with:
 *   - @workkit/do for typed storage, state machines, and DO client helpers
 *   - @workkit/hono for HTTP routing
 *   - Durable Objects for strongly consistent state
 *
 * The counter tracks a value and its lifecycle state:
 *   idle → counting → paused → counting → finalized
 */
import { Hono } from 'hono'
import { workkit, getEnv, workkitErrorHandler } from '@workkit/hono'
import { durableObject as doValidator } from '@workkit/env/validators'
import { typedStorage, createStateMachine, createDOClient, singleton, scheduleAlarm, createAlarmHandler } from '@workkit/do'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Schema for values stored in DO storage */
interface CounterStorage {
  count: number
  state: CounterState
  lastUpdated: string
  history: Array<{ action: string; value: number; at: string }>
}

type CounterState = 'idle' | 'counting' | 'paused' | 'finalized'

type CounterEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'finalize' }

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
  COUNTER: doValidator(),
}

// ─── Durable Object: Counter ──────────────────────────────────────────────────
//
// BEFORE (raw Durable Object):
//   export class Counter {
//     state: DurableObjectState
//     count: number = 0
//
//     constructor(state) { this.state = state }
//
//     async fetch(request) {
//       const url = new URL(request.url)
//       if (url.pathname === '/increment') {
//         this.count++
//         await this.state.storage.put('count', this.count)
//         return new Response(String(this.count))
//       }
//       // No types, manual serialization, no state machine
//     }
//   }
//
// AFTER (workkit):
//   - typedStorage<Schema> gives type-safe get/put
//   - createStateMachine enforces valid state transitions
//   - Alarm scheduling with human-readable durations

export class Counter implements DurableObject {
  private storage: ReturnType<typeof typedStorage<CounterStorage>>
  private machine: ReturnType<typeof createStateMachine<CounterState, CounterEvent>>
  private app: Hono

  constructor(private state: DurableObjectState, private env: unknown) {
    // Wrap raw storage with typed schema
    this.storage = typedStorage<CounterStorage>(this.state.storage as any)

    // Define the state machine — invalid transitions throw ValidationError
    this.machine = createStateMachine<CounterState, CounterEvent>({
      initial: 'idle',
      transitions: {
        idle:       { start: 'counting' },
        counting:   { pause: 'paused', finalize: 'finalized' },
        paused:     { resume: 'counting', finalize: 'finalized' },
        finalized:  {}, // Terminal state — no transitions out
      },
      async onTransition(from, to, event, storage) {
        await storage.put('state', to)
      },
    })

    // Set up Hono router for the DO
    this.app = new Hono()
    this.setupRoutes()
  }

  private setupRoutes() {
    // GET / — Current counter state
    this.app.get('/', async (c) => {
      const count = (await this.storage.get('count')) ?? 0
      const state = (await this.storage.get('state')) ?? 'idle'
      const lastUpdated = (await this.storage.get('lastUpdated')) ?? null

      return c.json({
        count,
        state,
        lastUpdated,
        validActions: this.machine.getValidEvents(),
      })
    })

    // POST /start — Begin counting
    this.app.post('/start', async (c) => {
      await this.machine.send({ type: 'start' }, this.state.storage as any)
      await this.storage.put('count', 0)
      await this.storage.put('lastUpdated', new Date().toISOString())
      return c.json({ state: this.machine.getState(), count: 0 })
    })

    // POST /increment — Add to counter (only while counting)
    this.app.post('/increment', async (c) => {
      const currentState = (await this.storage.get('state')) ?? 'idle'
      if (currentState !== 'counting') {
        return c.json({ error: `Cannot increment while ${currentState}` }, 400)
      }

      const body = await c.req.json().catch(() => ({})) as { amount?: number }
      const amount = body.amount ?? 1
      const count = ((await this.storage.get('count')) ?? 0) + amount

      await this.storage.put('count', count)
      await this.storage.put('lastUpdated', new Date().toISOString())

      // Record in history
      const history = (await this.storage.get('history')) ?? []
      history.push({ action: 'increment', value: amount, at: new Date().toISOString() })
      if (history.length > 100) history.splice(0, history.length - 100) // Keep last 100
      await this.storage.put('history', history)

      return c.json({ count, state: currentState })
    })

    // POST /decrement — Subtract from counter
    this.app.post('/decrement', async (c) => {
      const currentState = (await this.storage.get('state')) ?? 'idle'
      if (currentState !== 'counting') {
        return c.json({ error: `Cannot decrement while ${currentState}` }, 400)
      }

      const body = await c.req.json().catch(() => ({})) as { amount?: number }
      const amount = body.amount ?? 1
      const count = ((await this.storage.get('count')) ?? 0) - amount

      await this.storage.put('count', count)
      await this.storage.put('lastUpdated', new Date().toISOString())

      return c.json({ count, state: currentState })
    })

    // POST /pause — Pause counting
    this.app.post('/pause', async (c) => {
      await this.machine.send({ type: 'pause' }, this.state.storage as any)
      await this.storage.put('lastUpdated', new Date().toISOString())
      return c.json({ state: this.machine.getState() })
    })

    // POST /resume — Resume counting
    this.app.post('/resume', async (c) => {
      await this.machine.send({ type: 'resume' }, this.state.storage as any)
      await this.storage.put('lastUpdated', new Date().toISOString())
      return c.json({ state: this.machine.getState() })
    })

    // POST /finalize — Lock the counter permanently
    this.app.post('/finalize', async (c) => {
      await this.machine.send({ type: 'finalize' }, this.state.storage as any)
      await this.storage.put('lastUpdated', new Date().toISOString())
      const count = (await this.storage.get('count')) ?? 0
      return c.json({ state: this.machine.getState(), finalCount: count })
    })

    // GET /history — View action history
    this.app.get('/history', async (c) => {
      const history = (await this.storage.get('history')) ?? []
      return c.json({ history })
    })
  }

  async fetch(request: Request): Promise<Response> {
    // Restore state machine from storage on each request
    const storedState = await this.storage.get('state')
    if (storedState) {
      this.machine.reset()
      // Replay to stored state by finding the right transitions
      // (In production, you'd store the state and restore directly)
    }

    return this.app.fetch(request)
  }
}

// ─── Worker Entry Point ───────────────────────────────────────────────────────
//
// The Worker routes HTTP requests to the appropriate Durable Object instance.
// Each counter gets its own DO identified by name.

const app = new Hono<{ Bindings: Record<string, unknown> }>()

app.use('*', workkit({ env: envSchema }))
app.onError(workkitErrorHandler())

// Route: /counter/:name/* → forwards to the Counter DO
app.all('/counter/:name/*', async (c) => {
  const env = getEnv(c)
  const name = c.req.param('name')

  // Get a DO stub using the singleton helper (name-based ID)
  const stub = singleton(env.COUNTER as any, name)

  // Forward the request, rewriting the path to remove /counter/:name prefix
  const url = new URL(c.req.url)
  const doPath = url.pathname.replace(`/counter/${name}`, '') || '/'
  const doUrl = new URL(doPath, 'https://do-internal')

  return stub.fetch(new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  }))
})

// Route: /counter/:name (no trailing path) → forward to /
app.all('/counter/:name', async (c) => {
  const env = getEnv(c)
  const name = c.req.param('name')
  const stub = singleton(env.COUNTER as any, name)

  return stub.fetch(new Request('https://do-internal/', {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  }))
})

app.get('/', (c) => {
  return c.json({
    message: 'Realtime Counter — Durable Object with state machine',
    usage: 'Use /counter/:name to interact with a named counter',
    endpoints: [
      'GET    /counter/:name          — View counter state',
      'POST   /counter/:name/start    — Start counting',
      'POST   /counter/:name/increment — Increment (body: {amount: N})',
      'POST   /counter/:name/decrement — Decrement (body: {amount: N})',
      'POST   /counter/:name/pause    — Pause counting',
      'POST   /counter/:name/resume   — Resume counting',
      'POST   /counter/:name/finalize — Lock counter permanently',
      'GET    /counter/:name/history  — View action history',
    ],
  })
})

export default app
