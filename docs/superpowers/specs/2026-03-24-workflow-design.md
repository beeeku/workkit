# @workkit/workflow — Durable Agent Execution

**Date:** 2026-03-24
**Author:** Jarvis + Bikash
**Status:** Draft
**Package:** `@workkit/workflow`
**Dependencies:** `@workkit/do`, `@workkit/d1`, `@workkit/queue`, `@workkit/cron`, `@workkit/logger`, `@workkit/errors`, `@workkit/types`

---

## Overview

`@workkit/workflow` provides durable, checkpoint-based workflow execution on Cloudflare Workers. It is the **durable upgrade** from `@workkit/queue`'s `createWorkflow()`, which runs step chains in-memory within a single queue message handler — no persistence, no crash recovery, no replay.

This package offers two execution backends:

1. **DO-based backend** — Execution journal stored in Durable Object storage. Full control, works everywhere, no feature gates required.
2. **CF Workflows backend** — Wraps Cloudflare's native Workflows API (`step.do`, `step.sleep`, `step.waitForEvent`) with workkit's builder DX and type safety.

Same API surface. Same type inference chain. Different runtime underneath.

### Design Principles

- **Builder pattern with full type inference** — Every `.step()` narrows the type of the next step's `prev` parameter. No manual generics.
- **Checkpoint, not replay-all** — Each step's output is persisted. On crash, execution resumes from the last checkpoint, not from step 1.
- **Compensation is first-class** — Saga pattern built into the builder, not bolted on.
- **One DO per execution** — Each workflow run gets its own Durable Object instance. Clean isolation, no shared-state bugs.
- **Composable with the ecosystem** — `.asTool()` for MCP, `.cron()` for scheduling, logger/errors integration throughout.

---

## 1. Architecture

### 1.1 Dual Backend Model

```
                  createWorkflow('order-process', config)
                           │
                    ┌──────┴──────┐
                    │  WorkflowDef │  (builder result — pure data)
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌─────────────────┐     ┌──────────────────────┐
    │  DO Backend      │     │  CF Workflows Backend │
    │                  │     │                       │
    │  typedStorage()  │     │  step.do()            │
    │  createEvent     │     │  step.sleep()         │
    │    Store()       │     │  step.waitForEvent()  │
    │  scheduleAlarm() │     │                       │
    │  D1 history      │     │  Native dashboard     │
    └─────────────────┘     └──────────────────────┘
```

The `WorkflowDef` is backend-agnostic — it captures the step chain, retry policies, compensation handlers, and timeouts as data. The backend is selected at creation time via the `backend` config option.

### 1.2 DO-Based Backend — Execution Journal

Each workflow execution is a single Durable Object instance. The DO's storage holds:

1. **Execution metadata** — workflow name, input, status, timestamps
2. **Step journal** — ordered entries recording each step's input, output, timing, and status
3. **Pending wait state** — for `.wait()` steps (event name, timeout)
4. **Alarm state** — for `.sleep()` steps and heartbeat monitoring

**Storage key schema:**

```
wf:meta              → ExecutionMeta
wf:input             → TInput (serialized workflow input)
wf:step:{index}      → StepJournalEntry
wf:step:count        → number
wf:wait              → WaitState | undefined
wf:sleep             → SleepState | undefined
wf:heartbeat         → number (last heartbeat timestamp)
wf:cancel            → boolean
wf:version           → string (workflow definition version hash)
```

**Why one DO per execution:** Durable Objects have a 128KB transactional write limit and are single-threaded. Mixing multiple executions in one DO creates contention and makes cleanup impossible without scanning all keys. One DO per execution means clean lifecycle — create, run, archive, delete.

### 1.3 CF Workflows Backend

When `backend: 'cf-workflows'` is specified, the `WorkflowDef` is compiled into a class that extends Cloudflare's `WorkflowEntrypoint`. Each `.step()` becomes a `step.do()` call, `.sleep()` becomes `step.sleep()`, and `.wait()` becomes `step.waitForEvent()`.

The CF Workflows runtime handles checkpointing, replay, and scheduling natively. The workkit layer adds:

- Type-safe step chain inference (CF Workflows steps are untyped)
- Saga compensation (not natively supported)
- `.asTool()` / `.cron()` integration
- Unified history via D1 (CF Workflows has its own dashboard, but D1 history integrates with the rest of your workkit stack)

### 1.4 Step Chain Type Safety

The builder uses a recursive generic accumulator pattern. Each `.step()` call extends a type map that tracks the output type of every named step. The `prev` parameter of each handler is typed as this accumulated map.

```
createWorkflow<TInput>()
  .step<'validate', ValidateOutput>('validate', handler)
  → StepChain<TInput, { validate: ValidateOutput }>

  .step<'charge', ChargeOutput>('charge', handler)
  → StepChain<TInput, { validate: ValidateOutput; charge: ChargeOutput }>

  .step<'fulfill', FulfillOutput>('fulfill', handler)
  → StepChain<TInput, { validate: ValidateOutput; charge: ChargeOutput; fulfill: FulfillOutput }>
```

Each handler receives `prev` typed as the full accumulated map at that point. `prev.validate` is `ValidateOutput`. `prev.charge` is `ChargeOutput`. TypeScript infers all of this — no manual generics needed at the call site.

### 1.5 Replay Mechanics

On crash recovery (DO eviction, Worker timeout, unhandled exception):

1. The DO is re-instantiated from storage (Cloudflare guarantees this).
2. The alarm handler fires (heartbeat alarm was set during execution).
3. The executor reads `wf:step:count` and iterates the journal.
4. For each completed step (`status: 'completed'`), the output is loaded from the journal — **the handler is NOT re-executed**.
5. The accumulated `prev` map is reconstructed from journal entries.
6. Execution resumes at the first step with `status: 'pending'` or `status: 'running'`.
7. If the last step was `status: 'running'` (crash mid-step), it is re-executed. This is the **at-least-once** boundary — step handlers MUST be idempotent or use the idempotency key.

### 1.6 DO Lifecycle

```
  workflow.run(input)
       │
       ▼
  Generate execution ID (nanoid)
       │
       ▼
  Create DO instance (idFromName(executionId))
       │
       ▼
  POST /execute { input, workflowDef }
       │
       ▼
  DO writes meta + input to storage
       │
       ▼
  DO sets heartbeat alarm (30s)
       │
       ▼
  DO executes steps sequentially
       │
       ▼
  On completion: write final status, write D1 history, delete alarm
       │
       ▼
  DO remains addressable for queries until TTL expires
       │
       ▼
  After TTL (default 24h): DO storage is cleaned up via alarm
```

---

## 2. Complete API Surface

### 2.1 Core Types

```ts
import type { Result } from '@workkit/types'
import type { RetryStrategy } from '@workkit/errors'
import type { TypedDurableObjectStorage } from '@workkit/types'

// ── Execution Status ──

type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting'    // paused on .wait()
  | 'sleeping'   // paused on .sleep()

// ── Step Journal Entry ──

interface StepJournalEntry<TOutput = unknown> {
  index: number
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  input: unknown           // serialized prev map at time of invocation
  output?: TOutput         // serialized step output
  error?: SerializedStepError
  startedAt?: number       // Date.now()
  completedAt?: number
  duration?: number        // ms
  attempt: number          // 1-based
  idempotencyKey?: string
}

interface SerializedStepError {
  name: string
  message: string
  code?: string
  retryable: boolean
}

// ── Execution Metadata ──

interface ExecutionMeta {
  executionId: string
  workflowName: string
  workflowVersion: string
  status: WorkflowStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  currentStep?: string
  stepCount: number
  completedStepCount: number
  error?: SerializedStepError
}

// ── Execution Handle ──

interface ExecutionHandle<TOutput> {
  /** Unique execution ID */
  readonly executionId: string
  /** Poll for current status */
  status(): Promise<WorkflowStatus>
  /** Wait for completion (polls with backoff) */
  result(): Promise<Result<TOutput, WorkflowError>>
  /** Get the full execution metadata */
  meta(): Promise<ExecutionMeta>
  /** Get step-level journal */
  journal(): Promise<StepJournalEntry[]>
  /** Resume a waiting workflow with an event */
  resume(event: string, payload?: unknown): Promise<void>
  /** Cancel the execution */
  cancel(): Promise<void>
}

// ── Workflow Error ──

class WorkflowError extends WorkkitError {
  readonly executionId: string
  readonly failedStep: string
  readonly stepAttempt: number
  readonly journal: StepJournalEntry[]
}

// ── Backend Config ──

type WorkflowBackend =
  | { type: 'do'; namespace: DurableObjectNamespace; history?: D1Database }
  | { type: 'cf-workflows'; binding: WorkflowBinding }

// ── Workflow Config ──

interface WorkflowConfig {
  backend: WorkflowBackend
  /** Version string — used to detect definition changes on replay */
  version?: string
  /** Default retry strategy for all steps */
  retry?: RetryStrategy
  /** Default timeout for all steps (e.g. '30s', '5m') */
  timeout?: string
  /** Execution TTL — how long completed executions stay in DO storage */
  executionTtl?: string   // default '24h'
  /** Idempotency key extractor — prevent duplicate executions */
  idempotencyKey?: (input: unknown) => string
  /** D1 database for automatic large output offloading.
   *  When set, step outputs exceeding 32KB are stored in D1 instead of
   *  failing with StepOutputTooLargeError. A reference is stored in the
   *  journal and resolved transparently on replay. */
  largeOutputStorage?: D1Database
  /** Logger instance */
  logger?: Logger
}
```

### 2.2 `createDurableWorkflow()` Factory

The primary export. `createWorkflow` is also exported as a deprecated alias (pointing to `createDurableWorkflow`) to avoid collision with `@workkit/queue`'s in-memory `createWorkflow()`.

```ts
/**
 * Create a durable workflow definition.
 *
 * @example
 * ```ts
 * const orderWorkflow = createDurableWorkflow('process-order', {
 *   backend: { type: 'do', namespace: env.WORKFLOW_DO, history: env.DB },
 *   version: '1.0.0',
 *   retry: RetryStrategies.exponential(500, 30000, 3),
 *   timeout: '5m',
 * })
 *   .step('validate', async (input, prev) => {
 *     const order = await validateOrder(input.orderId)
 *     return { order, valid: true }
 *   })
 *   .step('charge', async (input, prev) => {
 *     const charge = await chargeCard(prev.validate.order)
 *     return { chargeId: charge.id }
 *   })
 *   .step('fulfill', async (input, prev) => {
 *     await createShipment(prev.validate.order, prev.charge.chargeId)
 *     return { shipped: true }
 *   })
 *   .onFailure(async (ctx) => {
 *     if (ctx.completedSteps.includes('charge')) {
 *       await refundCharge(ctx.stepOutputs.charge.chargeId)
 *     }
 *   })
 * ```
 */
function createDurableWorkflow<TInput>(
  name: string,
  config: WorkflowConfig,
): WorkflowBuilder<TInput, {}>

/** @deprecated Use createDurableWorkflow() — this alias exists to avoid collision with @workkit/queue's createWorkflow() */
const createWorkflow = createDurableWorkflow
```

### 2.3 `WorkflowBuilder` — The Chain

```ts
interface WorkflowBuilder<TInput, TPrev extends Record<string, unknown>> {
  /**
   * Add a sequential step. Handler receives the original input
   * and a typed map of all previous step outputs.
   */
  step<TName extends string, TOutput>(
    name: TName,
    handler: StepHandler<TInput, TPrev, TOutput>,
    options?: StepOptions,
  ): WorkflowBuilder<TInput, TPrev & Record<TName, TOutput>>

  /**
   * Add parallel steps. All handlers execute concurrently.
   * Each receives the same `prev` (outputs before this parallel group).
   * Outputs are merged into `prev` for subsequent steps.
   */
  parallel<TSteps extends Record<string, StepHandler<TInput, TPrev, any>>>(
    steps: TSteps,
    options?: ParallelOptions,
  ): WorkflowBuilder<TInput, TPrev & {
    [K in keyof TSteps]: TSteps[K] extends StepHandler<any, any, infer O> ? O : never
  }>

  /**
   * Pause execution until an external event is received.
   * Use `handle.resume(eventName, payload)` to continue.
   */
  wait<TName extends string, TPayload = unknown>(
    name: TName,
    eventName: string,
    options?: WaitOptions<TPayload>,
  ): WorkflowBuilder<TInput, TPrev & Record<TName, TPayload>>

  /**
   * Pause execution for a duration. Implemented via DO alarm
   * (DO backend) or step.sleep() (CF Workflows backend).
   */
  sleep(
    duration: string,  // '30s', '5m', '1h', '2d'
  ): WorkflowBuilder<TInput, TPrev>

  /**
   * Override retry strategy for the IMMEDIATELY NEXT .step() or .parallel() only.
   *
   * RULES:
   * - .retry() before .step() or .parallel() — valid
   * - .retry() before .sleep() or .wait() — COMPILE ERROR (return type restricts it)
   * - .retry().retry() — second call overrides first (TypeScript emits a @deprecated warning)
   *
   * Returns a restricted builder type that only allows .step() or .parallel() next.
   */
  retry(strategy: RetryStrategy): RestrictedWorkflowBuilder<TInput, TPrev>

  /**
   * Override timeout for the IMMEDIATELY NEXT .step() or .parallel() only.
   *
   * Same restriction rules as .retry():
   * - .timeout() before .sleep() or .wait() — COMPILE ERROR
   * - .timeout().timeout() — second overrides first with @deprecated warning
   */
  timeout(duration: string): RestrictedWorkflowBuilder<TInput, TPrev>

  /**
   * Register a compensation handler (saga pattern).
   * Called in reverse order of completed steps when any step fails.
   */
  onFailure(
    handler: CompensationHandler<TInput, TPrev>,
  ): WorkflowDef<TInput, TPrev>

  /**
   * Finalize the workflow definition without a compensation handler.
   */
  build(): WorkflowDef<TInput, TPrev>
}
```

### 2.3.1 Restricted Builder (enforces .retry()/.timeout() placement)

```ts
/**
 * Returned by .retry() and .timeout(). Only allows .step() or .parallel()
 * as the next call — .sleep(), .wait(), .build(), and .onFailure() are
 * excluded from the type, making them compile errors.
 *
 * .retry() returns this type to also allow .timeout() (and vice versa),
 * enabling .retry().timeout().step() chains.
 *
 * Calling .retry() or .timeout() again on this type is allowed but
 * marked @deprecated — the second call silently overrides the first.
 */
interface RestrictedWorkflowBuilder<TInput, TPrev extends Record<string, unknown>> {
  step<TName extends string, TOutput>(
    name: TName,
    handler: StepHandler<TInput, TPrev, TOutput>,
    options?: StepOptions,
  ): WorkflowBuilder<TInput, TPrev & Record<TName, TOutput>>

  parallel<TSteps extends Record<string, StepHandler<TInput, TPrev, any>>>(
    steps: TSteps,
    options?: ParallelOptions,
  ): WorkflowBuilder<TInput, TPrev & {
    [K in keyof TSteps]: TSteps[K] extends StepHandler<any, any, infer O> ? O : never
  }>

  /** Override timeout in addition to retry. */
  timeout(duration: string): RestrictedWorkflowBuilder<TInput, TPrev>

  /** Override retry in addition to timeout. */
  retry(strategy: RetryStrategy): RestrictedWorkflowBuilder<TInput, TPrev>

  // NOTE: .sleep(), .wait(), .build(), .onFailure() are intentionally ABSENT.
  // Attempting to call them after .retry() or .timeout() is a compile error.
}
```

**Example of the compile-time enforcement:**

```ts
const wf = createWorkflow<{ id: string }>('example', config)
  .step('a', async () => ({ done: true }))
  .retry(RetryStrategies.exponential(500, 30000, 3))
  .step('b', async () => ({ ok: true }))   // ✅ valid
  // .sleep('5m')                            // ❌ compile error — not on RestrictedWorkflowBuilder
  // .build()                                // ❌ compile error
```

### 2.4 Step Handler Types

```ts
/**
 * A step handler receives the workflow input and typed previous outputs.
 * Returns the step's output, which becomes available as prev.stepName.
 */
type StepHandler<TInput, TPrev, TOutput> = (
  input: TInput,
  prev: Readonly<TPrev>,
  ctx: StepContext,
) => Promise<TOutput>

/**
 * Context available to each step handler.
 */
interface StepContext {
  /** Current attempt number (1-based) */
  readonly attempt: number
  /** Execution ID */
  readonly executionId: string
  /** Step name */
  readonly stepName: string
  /** Logger scoped to this step */
  readonly log: Logger
  /** Signal for cooperative cancellation */
  readonly signal: AbortSignal
  /** Generate or retrieve the idempotency key for this step+execution */
  readonly idempotencyKey: string
}

/**
 * Options for a single step.
 */
interface StepOptions {
  /** Override retry strategy for this step */
  retry?: RetryStrategy
  /** Override timeout for this step (e.g. '30s') */
  timeout?: string
  /** Custom idempotency key — if not set, defaults to `${executionId}:${stepName}:${attempt}` */
  idempotencyKey?: (input: unknown) => string
}

/**
 * Options for parallel step groups.
 */
interface ParallelOptions {
  /** How many steps to run concurrently (default: all) */
  concurrency?: number
  /** If one fails, cancel others? (default: true) */
  failFast?: boolean
  /** Override retry strategy for all steps in this group */
  retry?: RetryStrategy
  /** Override timeout for all steps in this group */
  timeout?: string
}

/**
 * Options for wait steps.
 */
interface WaitOptions<TPayload> {
  /** Maximum time to wait before timing out (e.g. '24h') */
  timeout?: string
  /** Validate the incoming event payload before resuming */
  validate?: (payload: unknown) => payload is TPayload
}
```

### 2.5 Compensation Handler

```ts
/**
 * Compensation handler receives full context about the failure.
 */
type CompensationHandler<TInput, TPrev> = (
  ctx: CompensationContext<TInput, TPrev>,
) => Promise<void>

interface CompensationContext<TInput, TPrev> {
  /** The original workflow input */
  readonly input: TInput
  /** Which step failed */
  readonly failedStep: string
  /** The error from the failed step */
  readonly error: Error
  /** Names of steps that completed successfully */
  readonly completedSteps: readonly string[]
  /** Typed outputs of completed steps (partial TPrev) */
  readonly stepOutputs: Partial<TPrev>
  /** Logger scoped to compensation */
  readonly log: Logger
}
```

### 2.6 `WorkflowDef` — The Finalized Workflow

```ts
interface WorkflowDef<TInput, TOutput extends Record<string, unknown>> {
  /** The workflow name */
  readonly name: string
  /** The workflow version */
  readonly version: string

  /**
   * Start a new execution. Returns a handle for polling/control.
   *
   * @param input - The workflow input
   * @param options - Execution options
   * @returns Execution handle
   */
  run(input: TInput, options?: RunOptions): Promise<ExecutionHandle<TOutput>>

  /**
   * Resume a paused execution (waiting on .wait()).
   *
   * @param executionId - The execution to resume
   * @param event - The event name
   * @param payload - The event payload
   */
  resume(executionId: string, event: string, payload?: unknown): Promise<void>

  /**
   * Cancel a running or waiting execution.
   */
  cancel(executionId: string): Promise<void>

  /**
   * Get an execution handle for an existing execution.
   */
  execution(executionId: string): ExecutionHandle<TOutput>

  /**
   * Query execution history from D1.
   * Only available when `history` D1 database is configured.
   */
  history(query?: HistoryQuery): Promise<ExecutionHistoryPage>

  /**
   * Export as an MCP tool definition for @workkit/mcp.
   */
  asTool(options?: ToolOptions): McpToolDef

  /**
   * Create a cron-triggered version of this workflow.
   * Returns a CronTask compatible with @workkit/cron.
   */
  cron(schedule: string, inputFn?: () => TInput | Promise<TInput>): CronTask
}

interface RunOptions {
  /** Custom execution ID (default: auto-generated nanoid) */
  executionId?: string
  /** Idempotency key — if an execution with this key exists, return its handle */
  idempotencyKey?: string
  /** Delay before starting execution */
  delay?: string  // '5s', '1m'
}

interface HistoryQuery {
  status?: WorkflowStatus | WorkflowStatus[]
  after?: string   // cursor for pagination
  limit?: number   // default 50, max 1000
  from?: Date
  to?: Date
}

interface ExecutionHistoryPage {
  executions: ExecutionHistoryEntry[]
  cursor?: string   // pass as `after` for next page
  total: number
}

interface ExecutionHistoryEntry {
  executionId: string
  workflowName: string
  workflowVersion: string
  status: WorkflowStatus
  input: unknown
  output?: unknown
  error?: SerializedStepError
  stepCount: number
  completedStepCount: number
  createdAt: number
  startedAt?: number
  completedAt?: number
  duration?: number
}
```

### 2.7 Tool & Cron Integration

```ts
interface ToolOptions {
  /** Tool name (defaults to workflow name) */
  name?: string
  /** Tool description */
  description: string
  /** JSON Schema for the input parameter */
  inputSchema: JsonObject
  /** How to report progress to the MCP client */
  progress?: 'poll' | 'stream'
  /** Poll interval when progress is 'poll' (default: '2s') */
  pollInterval?: string
}

interface McpToolDef {
  name: string
  description: string
  inputSchema: JsonObject
  handler: (input: unknown) => Promise<McpToolResult>
}

interface McpToolResult {
  executionId: string
  status: WorkflowStatus
  output?: unknown
  error?: string
  /** URL for polling status (if applicable) */
  statusUrl?: string
}
```

---

## 3. Step Chain Type Safety

### 3.1 The Generic Inference Chain

The core trick is an **accumulator type parameter** `TPrev` that grows with each `.step()` call. TypeScript infers the return type of each handler and adds it to `TPrev` under the step name.

```ts
// Internal: how the builder tracks types
type StepDef<TName extends string, TInput, TPrev, TOutput> = {
  name: TName
  handler: StepHandler<TInput, TPrev, TOutput>
  options?: StepOptions
}

// The builder method signature ensures inference:
step<TName extends string, TOutput>(
  name: TName,
  handler: StepHandler<TInput, TPrev, TOutput>,
  options?: StepOptions,
): WorkflowBuilder<TInput, TPrev & Record<TName, TOutput>>
//                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                         TOutput is INFERRED from handler return type
//                         TName is INFERRED from the string literal
```

### 3.2 Inference in Practice

```ts
const wf = createWorkflow<{ orderId: string }>('order', config)
  // Step 1: prev is {} (empty)
  .step('validate', async (input, prev) => {
    //   input: { orderId: string }  ← TInput
    //   prev: {}                    ← TPrev (empty initially)
    return { valid: true, amount: 99.99 }
    // Return type inferred as { valid: boolean; amount: number }
  })
  // Step 2: prev is { validate: { valid: boolean; amount: number } }
  .step('charge', async (input, prev) => {
    const amount = prev.validate.amount  // ✅ typed as number
    // prev.validate.valid              // ✅ typed as boolean
    // prev.charge                      // ❌ compile error — doesn't exist yet
    return { chargeId: 'ch_123' }
  })
  // Step 3: prev is { validate: ...; charge: { chargeId: string } }
  .step('ship', async (input, prev) => {
    const chargeId = prev.charge.chargeId  // ✅ typed as string
    const amount = prev.validate.amount    // ✅ still accessible
    return { trackingNumber: 'TRK-456' }
  })
  .build()

// Final TOutput: {
//   validate: { valid: boolean; amount: number }
//   charge: { chargeId: string }
//   ship: { trackingNumber: string }
// }
```

### 3.3 Parallel Step Type Merging

```ts
.parallel({
  inventory: async (input, prev) => {
    return { reserved: true, warehouse: 'US-WEST' }
  },
  payment: async (input, prev) => {
    return { authorized: true, token: 'tok_abc' }
  },
})
// After .parallel(), TPrev gains:
// {
//   ...existingPrev,
//   inventory: { reserved: boolean; warehouse: string },
//   payment: { authorized: boolean; token: string },
// }
```

The parallel type extraction uses a mapped type:

```ts
type InferParallelOutputs<
  TSteps extends Record<string, StepHandler<any, any, any>>
> = {
  [K in keyof TSteps]: TSteps[K] extends StepHandler<any, any, infer O> ? O : never
}
```

### 3.4 Wait Step Payload Typing

```ts
.wait<'approval', { approved: boolean; approver: string }>(
  'approval',
  'order.approved',
  {
    timeout: '24h',
    validate: (p): p is { approved: boolean; approver: string } =>
      typeof p === 'object' && p !== null && 'approved' in p
  }
)
// After .wait(), TPrev gains:
// { approval: { approved: boolean; approver: string } }
```

### 3.5 Error Type Propagation

`WorkflowError` includes the full journal, which preserves the error chain. Each step that fails has its error serialized in `StepJournalEntry.error`. The `Result<TOutput, WorkflowError>` from `handle.result()` gives exhaustive error handling:

```ts
const result = await handle.result()
if (isErr(result)) {
  const err = result.error  // WorkflowError
  console.log(err.failedStep)    // 'charge'
  console.log(err.stepAttempt)   // 3
  console.log(err.journal)       // full step journal
}
```

---

## 4. Checkpoint & Replay

### 4.1 Journal Entry Schema

Each step produces a journal entry written to DO storage:

```ts
// Key: wf:step:{index} where index is zero-padded to 4 digits
// Example: wf:step:0000, wf:step:0001, ...

interface StepJournalEntry<TOutput = unknown> {
  index: number
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  input: unknown           // snapshot of `prev` at invocation time
  output?: TOutput         // step return value (only if completed)
  error?: SerializedStepError
  startedAt?: number
  completedAt?: number
  duration?: number
  attempt: number          // which attempt this entry represents
  idempotencyKey?: string  // for external dedup
}
```

**Write sequence for each step:**

```
1. Write entry with status: 'running', startedAt: Date.now()
2. Execute handler
3a. On success: overwrite entry with status: 'completed', output, completedAt, duration
3b. On failure: overwrite entry with status: 'failed', error, completedAt, duration
4. Update wf:meta with currentStep, completedStepCount
5. Set next heartbeat alarm
```

Steps 1 and 3 are each a single `storage.put()` — atomic within DO storage. The critical guarantee: if the Worker crashes between step 2 and step 3, the entry remains `status: 'running'`. On replay, this step is re-executed.

### 4.2 Replay Semantics

**What replay guarantees:**
- Completed steps are NEVER re-executed. Their outputs are read from the journal.
- A step marked `running` IS re-executed (crash recovery — it may have partially completed).
- Steps marked `pending` are executed normally.
- The `prev` accumulator is reconstructed by reading all completed step outputs from the journal.

**Idempotency boundary:**
- Steps that ONLY read/compute are naturally idempotent — safe to replay.
- Steps that call external APIs (charge a card, send an email) MUST use the idempotency key. The `ctx.idempotencyKey` is deterministic: `${executionId}:${stepName}:${attempt}`. Pass this to external APIs that support idempotency keys.
- Steps that write to databases should use transactions or upserts.

**Side effect guidance for users:**

```ts
// ✅ SAFE: External API with idempotency key
.step('charge', async (input, prev, ctx) => {
  const charge = await stripe.charges.create({
    amount: prev.validate.amount,
    idempotencyKey: ctx.idempotencyKey,  // deterministic per attempt
  })
  return { chargeId: charge.id }
})

// ⚠️ UNSAFE without idempotency: sending email
.step('notify', async (input, prev, ctx) => {
  // If this step crashes after send but before checkpoint,
  // it will be sent again on replay.
  await sendEmail(input.email, 'Order confirmed')
  return { notified: true }
})

// ✅ SAFE: Use a dedup table
.step('notify', async (input, prev, ctx) => {
  const alreadySent = await db.select('notifications')
    .where('idempotency_key', '=', ctx.idempotencyKey)
    .first()
  if (!alreadySent) {
    await sendEmail(input.email, 'Order confirmed')
    await db.insert('notifications').values({
      idempotency_key: ctx.idempotencyKey,
      sent_at: new Date()
    })
  }
  return { notified: true }
})
```

### 4.3 Step Versioning

The workflow definition has a `version` field (either explicit or auto-hashed from the step chain structure). This version is stored in the journal at `wf:version`.

**On replay, if the stored version differs from the current definition:**

1. The executor compares the stored step chain (names + order) with the current definition.
2. If the step names and order match — execution continues normally. Logic changes within a step are the user's responsibility (idempotency keys protect against partial re-execution).
3. If the step chain structure changed (steps added, removed, or reordered) — the execution fails with a `WorkflowVersionMismatchError`. This is intentional: replaying a different workflow than the one that started is undefined behavior.

**Version migration strategy:**

```ts
const orderWorkflowV2 = createWorkflow('process-order', {
  ...config,
  version: '2.0.0',  // New version — new executions use this
})
  .step('validate', ...)  // Same name, potentially different logic
  .step('fraud-check', ...)  // NEW step
  .step('charge', ...)
  .step('fulfill', ...)
  .build()

// Existing v1 executions continue with v1 logic (stored in their DO journal).
// New executions use v2. Both can coexist — different DO instances.
```

### 4.4 Journal Compaction

DO storage is not unlimited. The journal for a single execution is bounded by step count, but long-running workflows with many retries can accumulate entries.

**Strategy:**

1. **On completion:** After the execution finishes (completed/failed/cancelled), the full journal is written to D1 history (if configured). A compaction alarm fires after `executionTtl` (default 24h) and deletes all `wf:*` keys from DO storage.

2. **During execution:** Failed step attempts are kept (for debugging), but the journal entry is overwritten per-attempt — not appended. A step that retries 5 times has ONE journal entry with `attempt: 5`, not five entries. The previous attempts' errors are logged via `@workkit/logger` but not stored in DO.

3. **Size guard:** If a single step's output exceeds 32KB when serialized, the step **fails at write time** with a `StepOutputTooLargeError` (not silently truncated). The error message suggests storing large outputs in D1/R2 and returning a reference key instead. For automatic handling, configure `largeOutputStorage` in `WorkflowConfig` to offload large outputs to D1 automatically — the journal stores a reference, and `prev` transparently resolves it on the next step.

### 4.5 Storage Budget

Cloudflare DO storage limits:
- 128KB per `put()` call (single key-value pair)
- Unlimited total storage per DO (billed per GB-month)
- 128KB transactional write limit (all puts in a single `transaction()`)

**Budget allocation per execution:**

| Key | Estimated size |
|-----|---------------|
| `wf:meta` | ~500 bytes |
| `wf:input` | User-dependent (capped at 64KB via validation) |
| `wf:step:{n}` | ~1-32KB per step (output-dependent) |
| `wf:wait` / `wf:sleep` | ~200 bytes |
| `wf:heartbeat` | 8 bytes |
| `wf:cancel` | 1 byte |
| `wf:version` | ~50 bytes |

For a workflow with 20 steps averaging 4KB output each, total storage is ~80KB + metadata overhead. Well within limits for any reasonable workflow.

---

## 5. Compensation (Saga Pattern)

### 5.1 How `onFailure` Works

When any step fails (after exhausting retries), the compensation handler is invoked:

```ts
.onFailure(async (ctx) => {
  // ctx.failedStep: which step failed
  // ctx.error: the error
  // ctx.completedSteps: ['validate', 'charge'] — only steps that COMPLETED
  // ctx.stepOutputs: { validate: {...}, charge: {...} } — typed outputs
  // ctx.input: the original workflow input

  // Compensate in reverse order
  if (ctx.completedSteps.includes('charge')) {
    await refundCharge(ctx.stepOutputs.charge!.chargeId)
  }
  if (ctx.completedSteps.includes('validate')) {
    await releaseInventory(ctx.stepOutputs.validate!.reservationId)
  }
})
```

### 5.2 Compensation Ordering

The `completedSteps` array is in execution order. The compensation handler is responsible for ordering its own compensation logic. The framework provides the data; the user decides the strategy.

**Why not auto-reverse?** Different workflows need different compensation patterns:
- Some need exact reverse order (database transactions).
- Some need parallel compensation (independent resources).
- Some only compensate specific steps based on which step failed.
- Some need conditional compensation (only refund if amount > threshold).

Prescribing reverse-order would be wrong for half these cases. The `completedSteps` and `stepOutputs` give you everything you need to implement any strategy.

### 5.3 Partial Compensation

Only steps in `completedSteps` have outputs in `stepOutputs`. Steps that were never reached (after the failed step) are absent. Steps that failed are absent — they didn't complete, so there's nothing to compensate.

```ts
// Workflow: validate → charge → ship → notify
// Failure at: ship
// completedSteps: ['validate', 'charge']
// stepOutputs: { validate: {...}, charge: {...} }
// 'ship' is NOT in completedSteps — it failed
// 'notify' is NOT in completedSteps — it was never reached
```

### 5.4 Compensation Failure

If the compensation handler itself throws:

1. The error is logged via `@workkit/logger` at `error` level with full context.
2. The execution status is set to `'failed'` with a compound error: the original step failure AND the compensation failure.
3. The execution is written to D1 history with a `compensation_failed` flag.
4. An attention item is queued (if an attention queue is configured) — compensation failures are **critical** and need human review.

The framework does NOT retry compensation automatically. Compensation handlers should be written defensively (check before acting, use idempotency keys, handle already-compensated state). If compensation fails, it's a human problem.

### 5.5 Nested Sagas

For complex workflows, compensation can trigger sub-workflows:

```ts
.onFailure(async (ctx) => {
  if (ctx.completedSteps.includes('charge')) {
    // Start a compensation sub-workflow with its own durability
    const refundHandle = await refundWorkflow.run({
      chargeId: ctx.stepOutputs.charge!.chargeId,
      reason: `Compensation for failed step: ${ctx.failedStep}`,
    })
    const result = await refundHandle.result()
    if (isErr(result)) {
      ctx.log.error('Refund sub-workflow failed', { error: result.error })
      throw result.error  // escalate — triggers compensation failure handling
    }
  }
})
```

This is emergent from the API — no special "nested saga" feature is needed. A workflow can start other workflows. The durability of the sub-workflow is independent.

---

## 6. Edge Cases & Error Handling

### 6.1 DO Storage Write Failure During Checkpoint

**Scenario:** Step handler completes successfully, but `storage.put()` for the journal entry fails (DO internal error, storage quota exceeded).

**Handling:**
- The `storage.put()` is wrapped in a try-catch. If it fails, the step is treated as failed.
- The step output is lost — it cannot be persisted.
- The execution falls through to retry logic. On the next attempt, the step re-executes.
- If storage is persistently failing (quota exceeded), the execution fails after max retries with a `StorageError`.

**Mitigation:** The 32KB output cap (section 4.4) prevents the most common cause of storage write failure. Input validation caps at 64KB. These limits are enforced before execution starts.

### 6.2 Duplicate Execution (Idempotency)

**Scenario:** `workflow.run(input)` is called twice with the same logical input (network retry, user double-click).

**Handling via `idempotencyKey`:**

```ts
const handle = await orderWorkflow.run(input, {
  idempotencyKey: `order-${input.orderId}`,
})
```

When an idempotency key is provided:
1. Before creating a new DO, the framework checks a KV-based index (`wf:idem:{key}` → `executionId`).
2. If the key exists and the execution is still active (not expired), the existing execution handle is returned.
3. If the key exists but the execution has expired/completed, a new execution is created (the old key is overwritten).
4. The idempotency key is stored in both the DO (`wf:meta.idempotencyKey`) and the KV index.
5. The KV index entry has a **TTL of 48 hours** (2x the default `executionTtl` of 24h), ensuring the idempotency key outlives the execution it protects against.

**Without an idempotency key:** Every `run()` call creates a new execution. The caller is responsible for deduplication.

### 6.3 Non-Deterministic Steps on Replay

**Scenario:** A step generates a random ID, calls `Date.now()`, or reads external state that changes between runs. On replay (crash recovery), the step is re-executed and produces a different result.

**Handling:** This is the user's responsibility, enforced by documentation and the idempotency key pattern:

- **Random IDs:** Generate in a previous step and pass via `prev`, OR use `ctx.idempotencyKey` as a seed.
- **Timestamps:** Use `ctx.idempotencyKey` to look up the original timestamp from a dedup table.
- **External state:** Accept that replay may see different state. Design steps to be convergent (same outcome regardless of intermediate state), not deterministic (same computation).

The framework does NOT enforce determinism. This is a conscious design choice — CF Workers are not a state machine replay engine (like Temporal). Requiring determinism would prohibit most real-world step implementations.

### 6.4 External API Down (Retry with Backoff)

**Scenario:** Step calls an external API that returns 503. The step throws a `ServiceUnavailableError` from `@workkit/errors`.

**Handling:**

```ts
.step('charge', async (input, prev, ctx) => {
  const result = await chargeApi.create({ ... })
  return { chargeId: result.id }
}, {
  retry: RetryStrategies.exponential(1000, 30000, 5),
  timeout: '30s',
})
```

The retry loop is managed by the executor:
1. Step throws.
2. Executor checks `isRetryable(error)` from `@workkit/errors`.
3. If retryable and attempts remain, calculate delay via `getRetryDelay()`.
4. For the DO backend: set an alarm for `Date.now() + delay`, store retry state. When alarm fires, re-execute the step.
5. For the CF Workflows backend: `step.do()` with the retry config (CF Workflows has native retry support).
6. Each retry updates `attempt` in the journal entry.

**Important:** Retry delays are implemented via DO alarms, not `setTimeout` or busy-waiting. This means the Worker is NOT running during retry delays — no CPU time is consumed. The DO is woken by its alarm.

### 6.5 DO Eviction Mid-Execution

**Scenario:** Cloudflare evicts the DO instance from memory while a step is running (this can happen under extreme load or during deployments).

**Handling via heartbeat alarm:**

The executor sets a heartbeat alarm every 25 seconds (just under the 30s Worker CPU limit). The alarm handler checks:

1. Is `wf:meta.status` still `'running'`?
2. Is `wf:heartbeat` more than 60 seconds old? (allows for alarm scheduling delays)
3. If yes — the execution stalled. Resume from the last checkpoint.

This is the "dead man's switch" pattern. If the DO is evicted:
- The in-memory execution is lost.
- The alarm survives (alarms are durable).
- When the alarm fires, the DO is re-instantiated.
- The alarm handler detects the stall and resumes execution.

**Heartbeat alarm lifecycle:**

```
Step starts → set alarm(now + 25s) → step runs → step completes →
  update heartbeat timestamp → set alarm(now + 25s) → next step
  ...
Execution completes → delete alarm
```

### 6.6 Parallel Steps Writing to Same Resource

**Scenario:** Two parallel steps both write to the same database table or external API.

**Handling:** The framework does NOT provide coordination between parallel steps. Each step runs independently with its own `StepContext`. If parallel steps access shared resources, the user must handle coordination:

- Use database transactions or optimistic locking.
- Use separate keys/rows per step.
- Use `concurrency: 1` in `ParallelOptions` to serialize (defeats the purpose, but safe).

**Parallel steps sharing state:** Parallel steps all receive the same `prev` — the accumulated outputs BEFORE the parallel group. They cannot see each other's outputs. After all parallel steps complete, their outputs are merged into `prev` for subsequent steps.

### 6.7 Cancel During Step Execution

**Scenario:** `handle.cancel()` is called while a step is actively running.

**Handling — cooperative cancellation:**

1. `cancel()` writes `wf:cancel = true` to DO storage.
2. The currently running step's `ctx.signal` (AbortSignal) is aborted.
3. The step handler should check `ctx.signal.aborted` at natural break points:

```ts
.step('bulk-process', async (input, prev, ctx) => {
  for (const item of input.items) {
    if (ctx.signal.aborted) {
      return { processed: results.length, cancelled: true }
    }
    results.push(await processItem(item))
  }
  return { processed: results.length, cancelled: false }
})
```

4. After the current step completes (or throws `AbortError`), the executor checks `wf:cancel`.
5. If true, the execution transitions to `'cancelled'` status. Compensation runs if configured.
6. If the step ignores the abort signal, it runs to completion. Cancellation is cooperative, not preemptive — Workers can't be killed mid-execution.

### 6.8 Workflow Definition Changes Between Versions

**Scenario:** A workflow is deployed with 5 steps. An execution starts and completes 3 steps. The workflow is redeployed with a new step inserted at position 2. The DO alarm fires for the stalled execution.

**Handling:** See section 4.3. The version hash is checked on replay. If the step chain structure changed, the execution fails with `WorkflowVersionMismatchError`. The old execution's journal is preserved for debugging. The user must either:

1. Let old executions finish on the old version (recommended — they're in their own DOs).
2. Manually cancel old executions and re-run on the new version.

**Best practice:** Use semantic versioning for `config.version`. Old executions are isolated in their own DOs — they don't interfere with new ones.

### 6.9 Execution Time Limits (30s CPU)

**Scenario:** Cloudflare Workers have a 30-second CPU time limit per invocation. A step that does heavy computation could exceed this.

**Handling:**

- **DO backend:** Each step handler runs within a single DO `fetch()` or `alarm()` invocation. The 30s CPU limit applies. Steps that need more time should break work into sub-steps or use queues for fan-out.
- **Step timeout:** The `timeout` option kills the step (via AbortSignal) before the Worker hits the hard limit. Default: `'25s'` (5s safety margin).
- **Between steps:** After each step, the executor yields by setting a DO alarm for `Date.now()` (immediate) and returning. The next alarm invocation picks up execution. This resets the CPU clock. Each step gets a fresh 30s budget.

**This is the critical design decision:** Steps are NOT chained in a single invocation. Each step is a separate invocation, connected by DO alarms. This means a 10-step workflow uses 10 separate Worker invocations, each with its own 30s budget.

```
Invocation 1: execute step 0 → write journal → set alarm(now)
Invocation 2: execute step 1 → write journal → set alarm(now)
Invocation 3: execute step 2 → write journal → set alarm(now)
...
```

### 6.10 Memory Limits (Large Step Outputs)

**Scenario:** A step returns a massive object (100MB of data).

**Handling:**
- Step outputs are serialized to JSON for the journal. `JSON.stringify()` on a 100MB object will OOM the Worker.
- The framework validates output size before writing: if `JSON.stringify(output).length > 32 * 1024`, the step **fails with `StepOutputTooLargeError`**. The error message includes the actual size and the 32KB limit, with guidance to store large data in D1/R2 and return a reference.
- If `largeOutputStorage` is configured in `WorkflowConfig` (pointing to a D1 database), outputs exceeding 32KB are automatically offloaded to D1 and a reference is stored in the journal. On replay, `prev` transparently resolves the reference back to the full data.
- **Guidance:** Keep step outputs small. Use R2 for large blobs — store the R2 key in the step output, not the blob itself.

### 6.11 D1 History Write Failure

**Scenario:** Execution completes successfully, but the D1 `INSERT` for history fails (D1 outage, constraint violation).

**Handling:**
- The D1 write is **fire-and-forget with retry**. It runs after the execution status is set to `completed` in DO storage.
- If it fails, the executor retries 3 times with 1s delay.
- If all retries fail, a warning is logged. The execution is still recorded as completed in DO storage — the DO is the source of truth, D1 is the secondary index.
- A periodic "history sync" alarm can be configured to scan DO executions missing from D1 and backfill.

### 6.12 Clock Skew for Sleep Timing

**Scenario:** `workflow.sleep('5m')` schedules a DO alarm. But DO alarm scheduling uses the DO's internal clock, which may differ from the Worker's `Date.now()`.

**Handling:**
- Cloudflare guarantees that DO alarms fire "at or after" the scheduled time. There is no clock skew problem within a single DO — the alarm is relative to the DO's own clock.
- Between different DOs (e.g., two parallel workflow executions), there may be slight timing differences. This is acceptable — sleep durations are approximate, not precise.
- The framework stores `sleepUntil: number` (absolute timestamp) in `wf:sleep`. The alarm handler checks `Date.now() >= sleepUntil`. If the alarm fires slightly early (rare), it re-schedules for the remaining time.

---

## 7. CF Workflows Integration

### 7.1 Native Backend Configuration

```ts
import { createWorkflow } from '@workkit/workflow'

const orderWorkflow = createWorkflow('process-order', {
  backend: {
    type: 'cf-workflows',
    binding: env.ORDER_WORKFLOW,  // Workflow binding from wrangler.toml
  },
  version: '1.0.0',
})
  .step('validate', async (input, prev) => { ... })
  .step('charge', async (input, prev) => { ... })
  .build()
```

### 7.2 API Mapping

| workkit API | CF Workflows API | Notes |
|-------------|-----------------|-------|
| `.step(name, handler)` | `step.do(name, handler)` | Direct mapping. Handler return type is preserved. |
| `.sleep(duration)` | `step.sleep(name, duration)` | Duration string is parsed to CF format. |
| `.wait(name, event)` | `step.waitForEvent(name, { type: event, timeout })` | Event name maps to `type` field. |
| `.parallel(steps)` | Multiple `step.do()` with `Promise.all()` | CF Workflows doesn't have native parallel. |
| `.retry(strategy)` | `step.do(name, { retries: { limit, delay, backoff } })` | Strategy is converted to CF retry config. |
| `.timeout(duration)` | `step.do(name, { timeout: duration })` | Direct mapping. |
| `.onFailure(handler)` | try/catch wrapper in the Workflow class `run()` | CF Workflows doesn't have native compensation. |

### 7.3 Feature Parity Matrix

| Feature | DO Backend | CF Workflows Backend |
|---------|-----------|---------------------|
| Step execution | ✅ | ✅ |
| Checkpoint/replay | ✅ (DO journal) | ✅ (native) |
| Typed step chain | ✅ | ✅ |
| Step retry | ✅ (alarm-based) | ✅ (native) |
| Step timeout | ✅ (AbortSignal) | ✅ (native) |
| Sleep | ✅ (alarm-based) | ✅ (`step.sleep()`) |
| Wait for event | ✅ (DO storage + alarm) | ✅ (`step.waitForEvent()`) |
| Parallel steps | ✅ (`Promise.all`) | ✅ (`Promise.all`) — see note below |
| Compensation / saga | ✅ | ✅ (implemented in wrapper) |
| D1 history | ✅ | ✅ |
| `.asTool()` | ✅ | ✅ |
| `.cron()` | ✅ | ✅ |
| Cancel | ✅ (cooperative) | ✅ (native `instance.abort()`) |
| Resume | ✅ (DO method) | ✅ (`instance.sendEvent()`) |
| Heartbeat monitoring | ✅ (alarm-based) | ❌ (not needed — native runtime) |
| Custom execution ID | ✅ | ⚠️ (CF generates its own ID, mapped) |
| Idempotency key | ✅ (KV index) | ⚠️ (user-managed — no native support) |
| Step journal introspection | ✅ (full control) | ⚠️ (limited — CF dashboard only) |
| Real-time status polling | ✅ (DO fetch) | ✅ (`instance.status()`) |

**Known behavioral difference — parallel step failure:**

- **DO backend:** When `failFast: true` (default), the first parallel step failure cancels all other in-flight steps via `AbortSignal`. Only completed step outputs are preserved; cancelled steps are marked `skipped`.
- **CF Workflows backend:** `Promise.all()` is used under the hood, but CF Workflows does not support cooperative cancellation of sibling `step.do()` calls. All parallel steps run to completion independently, even if one fails. The failure is only surfaced after all steps settle. This means cancelled side effects are not prevented on the CF Workflows backend.

This is a known behavioral difference between backends. If fail-fast semantics with cancellation are critical, use the DO backend.

### 7.4 Migration Path

```
Phase 1: Start with DO backend (works everywhere)
  └── createWorkflow('order', { backend: { type: 'do', ... } })

Phase 2: Enable CF Workflows in wrangler.toml
  └── Add [[workflows]] binding

Phase 3: Switch backend config
  └── createWorkflow('order', { backend: { type: 'cf-workflows', binding: env.ORDER_WORKFLOW } })

Phase 4: (Optional) Remove DO namespace from bindings
```

**Zero code changes for the step chain.** Only the `config.backend` line changes. All step handlers, compensation logic, and integrations remain identical.

---

## 8. Testing

### 8.1 In-Memory Test Runner

```ts
import { testWorkflow } from '@workkit/workflow/testing'

const runner = testWorkflow(orderWorkflow)

// Run synchronously — no DO, no alarms, steps execute in-memory
const result = await runner.run({ orderId: 'test-123' })

expect(result.status).toBe('completed')
expect(result.output.validate.valid).toBe(true)
expect(result.output.charge.chargeId).toBeDefined()
expect(result.steps).toHaveLength(3)
expect(result.steps[0].name).toBe('validate')
expect(result.steps[0].duration).toBeLessThan(1000)
```

The `testWorkflow()` function strips the backend entirely. Steps run as plain async functions in sequence. No storage, no alarms, no network.

### 8.2 Testing Compensation

```ts
const runner = testWorkflow(orderWorkflow, {
  // Make the 'charge' step fail
  failAt: 'charge',
  failWith: new ServiceUnavailableError('Payment gateway down'),
})

const result = await runner.run({ orderId: 'test-123' })

expect(result.status).toBe('failed')
expect(result.failedStep).toBe('charge')
expect(result.compensationRan).toBe(true)
expect(result.compensationError).toBeUndefined()

// Verify specific compensation side effects via your own mocks
expect(mockRefundApi.calls).toHaveLength(0) // charge never completed, no refund needed
```

```ts
// Test compensation for a LATER step failure
const runner2 = testWorkflow(orderWorkflow, {
  failAt: 'fulfill',
  failWith: new Error('Warehouse unavailable'),
})

const result2 = await runner2.run({ orderId: 'test-456' })
expect(result2.compensationRan).toBe(true)
// validate and charge completed → compensation should have run for both
```

### 8.3 Testing Replay (Crash Simulation)

```ts
import { testWorkflow } from '@workkit/workflow/testing'

const runner = testWorkflow(orderWorkflow, {
  // Simulate crash after step 1 completes
  crashAfterStep: 'validate',
})

// First run: executes validate, then "crashes"
const partial = await runner.run({ orderId: 'test-789' })
expect(partial.status).toBe('crashed')
expect(partial.completedSteps).toEqual(['validate'])

// Resume: should skip validate, continue from charge
const resumed = await runner.resume()
expect(resumed.status).toBe('completed')
expect(resumed.stepsExecuted).toEqual(['charge', 'fulfill'])  // validate was skipped
expect(resumed.stepsSkipped).toEqual(['validate'])  // replayed from journal
```

### 8.4 Testing Parallel Steps

```ts
const runner = testWorkflow(parallelWorkflow)

const result = await runner.run({ orderId: 'test-parallel' })

// Verify parallel group executed
expect(result.steps.find(s => s.name === 'inventory')?.startedAt)
  .toBeDefined()
expect(result.steps.find(s => s.name === 'payment')?.startedAt)
  .toBeDefined()

// In test mode, parallel steps run concurrently via Promise.all
// but without real DO infrastructure
```

### 8.5 Testing Wait Steps

```ts
const runner = testWorkflow(approvalWorkflow)

// Start execution — it will pause at the wait step
const handle = await runner.run({ orderId: 'test-wait' })
expect(handle.status).toBe('waiting')
expect(handle.waitingFor).toBe('order.approved')

// Simulate the external event
await handle.sendEvent('order.approved', {
  approved: true,
  approver: 'admin@example.com',
})

// Execution continues
const result = await handle.result()
expect(result.status).toBe('completed')
```

### 8.6 Test Runner API

```ts
interface TestWorkflowRunner<TInput, TOutput> {
  run(input: TInput): Promise<TestRunResult<TOutput>>
  resume(): Promise<TestRunResult<TOutput>>
}

interface TestRunResult<TOutput> {
  status: WorkflowStatus | 'crashed'
  output?: TOutput
  error?: Error
  failedStep?: string
  steps: TestStepResult[]
  completedSteps: string[]
  stepsExecuted: string[]   // steps that actually ran (not replayed)
  stepsSkipped: string[]    // steps replayed from journal
  compensationRan: boolean
  compensationError?: Error
  waitingFor?: string       // event name if status is 'waiting'
  sendEvent(name: string, payload?: unknown): Promise<void>
  result(): Promise<TestRunResult<TOutput>>
}

interface TestStepResult {
  name: string
  status: string
  output?: unknown
  error?: Error
  startedAt?: number
  completedAt?: number
  duration?: number
  attempt: number
}

interface TestWorkflowOptions {
  failAt?: string           // step name to fail at
  failWith?: Error          // error to throw
  crashAfterStep?: string   // simulate crash after this step
  stepOverrides?: Record<string, (input: any, prev: any) => Promise<any>>
}
```

---

## 9. Integration with @workkit/mcp

### 9.1 `workflow.asTool()` Middleware

```ts
const orderTool = orderWorkflow.asTool({
  description: 'Process a customer order end-to-end',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'The order ID to process' },
    },
    required: ['orderId'],
  },
  progress: 'poll',
  pollInterval: '2s',
})

// Register with @workkit/mcp
const mcp = createMcpServer({
  tools: [orderTool],
})
```

### 9.2 Long-Running Workflow Progress

When `progress: 'poll'` is set, the tool handler:

1. Starts the workflow via `workflow.run(input)`.
2. Returns immediately with `{ executionId, status: 'running', statusUrl }`.
3. The MCP client polls `statusUrl` (a route on the Worker) for updates.
4. Each poll returns current status, current step name, and completed step count.

When `progress: 'stream'` is set (requires MCP streaming support):

1. Starts the workflow.
2. Opens an SSE stream to the MCP client.
3. Each step completion emits a progress event: `{ step: 'validate', status: 'completed', progress: '1/3' }`.
4. Final event includes the output.

### 9.3 Execution Handle in Tool Response

```ts
// Tool handler (internal)
async handler(input: unknown): Promise<McpToolResult> {
  const handle = await workflow.run(input as TInput)

  if (progress === 'poll') {
    return {
      executionId: handle.executionId,
      status: 'running',
      statusUrl: `/workflow/${workflow.name}/executions/${handle.executionId}`,
    }
  }

  // For 'stream' mode or short workflows, wait for result
  const result = await handle.result()
  return {
    executionId: handle.executionId,
    status: isOk(result) ? 'completed' : 'failed',
    output: isOk(result) ? result.value : undefined,
    error: isErr(result) ? result.error.message : undefined,
  }
}
```

---

## 10. Observability

### 10.1 Step-Level Logging

Every step handler receives `ctx.log` — a child logger from `@workkit/logger` scoped to the step:

```ts
.step('charge', async (input, prev, ctx) => {
  ctx.log.info('Charging card', { amount: prev.validate.amount })
  const charge = await chargeApi.create({ ... })
  ctx.log.info('Charge successful', { chargeId: charge.id })
  return { chargeId: charge.id }
})
```

Log output includes structured fields:

```json
{
  "level": "info",
  "message": "Charging card",
  "workflow": "process-order",
  "executionId": "exec_abc123",
  "step": "charge",
  "attempt": 1,
  "amount": 99.99
}
```

### 10.2 Execution Metrics

The executor automatically tracks metrics per execution:

```ts
interface ExecutionMetrics {
  workflowName: string
  executionId: string
  status: WorkflowStatus
  totalDuration: number        // ms from start to completion
  stepCount: number
  completedStepCount: number
  failedStepCount: number
  retriedStepCount: number
  totalRetries: number         // sum of all step retries
  compensationRan: boolean
  compensationDuration?: number
  steps: StepMetrics[]
}

interface StepMetrics {
  name: string
  duration: number
  attempts: number
  status: string
}
```

Metrics are emitted via the logger at execution completion:

```ts
ctx.log.info('Workflow completed', { metrics: executionMetrics })
```

For advanced metrics (Prometheus, Datadog), users attach a custom logger transport that extracts these structured fields.

### 10.3 D1 History Schema

```sql
CREATE TABLE workflow_executions (
  execution_id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,              -- JSON
  output TEXT,             -- JSON
  error TEXT,              -- JSON (SerializedStepError)
  step_count INTEGER NOT NULL DEFAULT 0,
  completed_step_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,
  compensation_ran INTEGER DEFAULT 0,
  idempotency_key TEXT,
  UNIQUE(idempotency_key)
);

CREATE INDEX idx_wf_exec_name ON workflow_executions(workflow_name);
CREATE INDEX idx_wf_exec_status ON workflow_executions(status);
CREATE INDEX idx_wf_exec_created ON workflow_executions(created_at);
CREATE INDEX idx_wf_exec_idem ON workflow_executions(idempotency_key);

CREATE TABLE workflow_steps (
  execution_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,             -- JSON (may be truncated)
  error TEXT,              -- JSON
  started_at INTEGER,
  completed_at INTEGER,
  duration INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (execution_id, step_index),
  FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id)
);
```

### 10.4 Integration Point: Approval Steps

The `.wait()` primitive enables human-in-the-loop workflows. Combined with a notification system (Telegram, email, webhook), this becomes an approval gate:

```ts
const deployWorkflow = createWorkflow('deploy', config)
  .step('build', async (input, prev) => { ... })
  .step('test', async (input, prev) => { ... })
  .wait<'approval', { approved: boolean }>('approval', 'deploy.approved', {
    timeout: '4h',
  })
  .step('deploy', async (input, prev) => {
    if (!prev.approval.approved) {
      return { deployed: false, reason: 'Rejected' }
    }
    await deployToProduction()
    return { deployed: true }
  })
  .build()
```

The approval notification (sending a Telegram message with approve/reject buttons) is handled by a step BEFORE the `.wait()`, or by an external system that knows to call `workflow.resume(executionId, 'deploy.approved', { approved: true })`.

---

## Appendix A: Complete Usage Example

```ts
import { createWorkflow } from '@workkit/workflow'
import { RetryStrategies } from '@workkit/errors'
import { createLogger } from '@workkit/logger'
import { d1 } from '@workkit/d1'

// Define the workflow
const orderWorkflow = createWorkflow<{
  orderId: string
  customerId: string
  items: Array<{ sku: string; quantity: number }>
}>('process-order', {
  backend: { type: 'do', namespace: env.WORKFLOW_DO, history: env.DB },
  version: '1.2.0',
  retry: RetryStrategies.exponential(500, 30000, 3),
  timeout: '30s',
  logger: createLogger({ name: 'order-workflow' }),
})
  .step('validate', async (input, prev, ctx) => {
    ctx.log.info('Validating order', { orderId: input.orderId })
    const db = d1(env.DB)
    const customer = await db.select('customers')
      .where('id', '=', input.customerId)
      .first()
    if (!customer) throw new Error('Customer not found')

    const total = input.items.reduce((sum, i) => sum + i.quantity * 10, 0)
    return { customer, total, validated: true }
  })

  .parallel({
    inventory: async (input, prev, ctx) => {
      for (const item of input.items) {
        await reserveInventory(item.sku, item.quantity, ctx.idempotencyKey)
      }
      return { reserved: true }
    },
    fraud: async (input, prev, ctx) => {
      const score = await checkFraud(input.customerId, prev.validate.total)
      return { fraudScore: score, passed: score < 0.7 }
    },
  }, { failFast: true })

  .step('charge', async (input, prev, ctx) => {
    if (!prev.fraud.passed) {
      throw new Error(`Fraud check failed: score ${prev.fraud.fraudScore}`)
    }
    const charge = await stripe.charges.create({
      amount: prev.validate.total * 100,
      customer: prev.validate.customer.stripeId,
      idempotencyKey: ctx.idempotencyKey,
    })
    return { chargeId: charge.id, amount: prev.validate.total }
  })

  .sleep('2s')  // Small delay before fulfillment

  .step('fulfill', async (input, prev, ctx) => {
    const shipment = await createShipment({
      orderId: input.orderId,
      items: input.items,
      idempotencyKey: ctx.idempotencyKey,
    })
    return { trackingNumber: shipment.tracking, shipped: true }
  })

  .step('notify', async (input, prev, ctx) => {
    await sendOrderConfirmation({
      email: prev.validate.customer.email,
      orderId: input.orderId,
      trackingNumber: prev.fulfill.trackingNumber,
      total: prev.charge.amount,
      idempotencyKey: ctx.idempotencyKey,
    })
    return { notified: true }
  })

  .onFailure(async (ctx) => {
    ctx.log.warn('Order failed, compensating', {
      failedStep: ctx.failedStep,
      completedSteps: ctx.completedSteps,
    })

    // Reverse charge if it completed
    if (ctx.completedSteps.includes('charge')) {
      await stripe.refunds.create({
        charge: ctx.stepOutputs.charge!.chargeId,
      })
    }

    // Release inventory if it was reserved
    if (ctx.completedSteps.includes('inventory')) {
      await releaseAllInventory(ctx.input.items)
    }
  })

// --- Usage ---

// Start execution
const handle = await orderWorkflow.run({
  orderId: 'ORD-001',
  customerId: 'CUST-42',
  items: [{ sku: 'WIDGET-A', quantity: 2 }],
}, {
  idempotencyKey: 'order-ORD-001',
})

// Poll status
const status = await handle.status()  // 'running'

// Wait for completion
const result = await handle.result()
if (isOk(result)) {
  console.log('Order processed:', result.value.fulfill.trackingNumber)
} else {
  console.error('Order failed:', result.error.message)
}

// Query history
const history = await orderWorkflow.history({
  status: ['completed', 'failed'],
  limit: 20,
})

// Schedule as cron job (e.g., process pending orders every hour)
const cronTask = orderWorkflow.cron('0 * * * *', async () => {
  const pendingOrder = await getNextPendingOrder()
  return pendingOrder
})

// Expose as MCP tool
const tool = orderWorkflow.asTool({
  description: 'Process a customer order',
  inputSchema: { /* JSON Schema */ },
  progress: 'poll',
})
```

---

## Appendix B: DO Class Implementation Sketch

The `@workkit/workflow` package exports a DO class factory for the DO backend:

```ts
import { createWorkflowDO } from '@workkit/workflow'

// In wrangler.toml: [[durable_objects.bindings]] name = "WORKFLOW_DO"
export const WorkflowDO = createWorkflowDO({
  // Registry of all workflow definitions (needed for replay)
  workflows: {
    'process-order': orderWorkflow,
    'refund': refundWorkflow,
  },
})
```

The DO class handles:
- `fetch()` for `run()`, `resume()`, `cancel()`, `status()`, `journal()` requests
- `alarm()` for heartbeat, sleep, retry, and cleanup

Each DO instance is bound to a single execution. The execution ID IS the DO name (`idFromName(executionId)`).

---

## Appendix C: Migration from `@workkit/queue` `createWorkflow()`

| `@workkit/queue` | `@workkit/workflow` | Notes |
|-------------------|---------------------|-------|
| `createWorkflow<Body, Ctx>()` | `createWorkflow<TInput>()` | Input type, not separate body/context |
| `steps: [{ name, process, rollback }]` | `.step(name, handler)` + `.onFailure()` | Builder pattern, typed chain |
| `process(body, ctx)` returns `Partial<Ctx>` | `handler(input, prev, ctx)` returns `TOutput` | Full type inference, no `Partial` |
| `rollback(body, ctx)` per step | `.onFailure(ctx)` centralized | One compensation handler, full context |
| In-memory context | DO-checkpointed journal | Survives crashes |
| Queue retry on failure | Per-step retry with backoff | Alarm-based delays |
| No history | D1 history with queries | Full execution audit trail |
| No parallel | `.parallel()` | Fan-out with typed merge |
| No wait/sleep | `.wait()`, `.sleep()` | Human-in-the-loop, delays |
| No cancel | `.cancel()` cooperative | AbortSignal-based |
| No MCP | `.asTool()` | First-class MCP integration |
| No cron | `.cron()` | Schedule any workflow |
