---
title: "Durable Workflows"
---

# Durable Workflows

`@workkit/workflow` is durable workflow execution on Cloudflare Workers — checkpoint-and-replay multi-step orchestrations, automatic retry with backoff, and saga compensation handlers. Backed by a Durable Object so each execution survives Worker restarts and CPU limits.

> **v0.1.0 status:** the DO backend is implemented. Cloudflare Workflows (`cf-workflows`) backend and external pause/resume (`ExecutionHandle.resume()`) are stubbed and throw "Not supported in v0.1.0". Track the package CHANGELOG for when they land.

## Install

```bash
bun add @workkit/workflow @workkit/errors
```

## Bindings

| Binding | Purpose | Required |
|---|---|---|
| `DurableObjectNamespace` | Per-execution state + journal | Yes (for `do` backend) |
| `D1Database` | Optional history projection for queryable execution audit | No |

Re-export the DO class from your worker so the binding can find it:

```ts
import { WorkflowExecutionDO } from "@workkit/workflow";
export { WorkflowExecutionDO };
```

## Quick start

```ts
import { createDurableWorkflow } from "@workkit/workflow";

const orderFlow = createDurableWorkflow("order-flow", {
  backend: { type: "do", namespace: env.WORKFLOW_DO },
  retry: { maxAttempts: 3, initialDelay: 1_000, maxDelay: 30_000, backoffMultiplier: 2 },
  timeout: "10m",
})
  .step("reserve-inventory", async (input, _prev, ctx) => {
    return reserveInventory(input.orderId, input.items);
  })
  .step("charge-card", async (input, prev, ctx) => {
    return chargeCard(input.userId, input.amount, { reservationId: prev.reservationId });
  })
  .step("ship", async (input, prev, ctx) => {
    return shipOrder(input.orderId, prev.transactionId);
  })
  .onFailure(async (ctx) => {
    if (ctx.stepOutputs["charge-card"]) await refund(ctx.stepOutputs["charge-card"].transactionId);
    if (ctx.stepOutputs["reserve-inventory"]) await releaseInventory(ctx.stepOutputs["reserve-inventory"].reservationId);
  });

const handle = await orderFlow.run({ orderId: "o-1", userId: "u-1", amount: 99.99, items: [...] });
const result = await handle.result();
if (result.ok) console.log("done", result.value);
else console.error(result.error.failedStep, result.error.message);
```

In v0.1.x `run()` itself awaits the DO `/execute` call until the workflow terminates — by the time it resolves, the journal is final. `result()` then reads the current status and returns `{ ok: true; value }` for `completed` or `{ ok: false; error }` for `failed` / `cancelled` without further polling. Use `handle.status()` directly if you want to inspect intermediate state from another caller (e.g. a separate request inspecting an `executionId`).

## Step semantics

Each `.step(name, handler, options?)`:

- Runs the handler exactly once per execution under normal operation. Output is journaled.
- Replays from the journal on cold start — `handler` only re-runs if the previous attempt did not journal a result.
- Retries on thrown errors using the workflow `retry` strategy (per-step override via `options.retry`).
- Marks errors as `retryable: false` to short-circuit retries (use `Object.assign(err, { retryable: false })` or throw a `WorkflowError`).
- Per-step `idempotencyKey(input, ctx)` lets you dedupe side effects when retries reach external systems.

## Compensation (saga)

`onFailure(handler)` runs once when a step exhausts retries or throws non-retryably. The compensation context exposes:

```ts
type CompensationContext = {
  executionId: string;
  failedStep: string;
  error: SerializedStepError;
  stepOutputs: Record<string, unknown>;  // outputs from successful steps
  input: unknown;
};
```

Use it to undo committed work in reverse order. Compensation itself is not retried — wrap external calls in try/catch and log structured failures.

## Pause / resume (roadmap)

External pause/resume is not in v0.1.0. `ExecutionHandle.resume(event, payload)` exists in the type signature but throws "Not supported in v0.1.0" at runtime. For now, model human-in-the-loop steps by:

- Returning the in-flight `executionId` to the caller and storing it.
- Letting the user act (approve in `@workkit/approval`, click a link, etc.).
- Starting a new follow-up workflow keyed on the original execution.

When `resume()` lands, the journal will gain a `waiting` state so cold-start replay can skip past suspended steps.

## Status, journal, cancel

```ts
const handle = orderFlow.execution(id);
await handle.status();   // "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting" | "sleeping"
await handle.journal();  // StepJournalEntry[] — full per-step audit trail
await handle.meta();     // ExecutionMeta — input, started/finished, attempts
await handle.cancel();   // marks cancelled; compensation runs
```

## Errors

Terminal failures surface through the `result()` discriminated union as `WorkflowError`:

```ts
type WorkflowError = {
  executionId: string;
  failedStep: string;
  stepAttempt: number;
  message: string;
  journal: StepJournalEntry[];
};
```

`SerializedStepError` (in journal entries) carries `code`, `message`, `retryable`, `attempt`, and timing.

## Idempotency

Always set `idempotencyKey` on steps that POST money, send messages, or write to external state:

```ts
.step("charge-card", handler, {
  idempotencyKey: (input) => `charge:${input.orderId}`,
})
```

The key is hashed and stored on the journal entry. On replay, the handler is skipped and the previous result returned — even if the original request reached the external system but the response was lost.

## Cloudflare Workflows backend (roadmap)

`backend: { type: "cf-workflows", binding }` is reserved in the type but not yet implemented — instantiating a workflow with that backend throws "Only DO backend supported in v0.1.0". Track the package CHANGELOG.

## See also

- [Durable Objects](/workkit/guides/durable-objects/) — `@workkit/do` primitives that the DO backend builds on.
- [Approval Workflows](/workkit/guides/approval-workflows/) — model human-in-the-loop by chaining a follow-up workflow from an approval decision.
- [Queues and Crons](/workkit/guides/queues-and-crons/) — schedule workflow runs from cron triggers or queue messages.
