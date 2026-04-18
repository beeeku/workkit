---
title: "Durable Workflows"
---

# Durable Workflows

`@workkit/workflow` is durable workflow execution on Cloudflare Workers — checkpoint-and-replay multi-step orchestrations, automatic retry with backoff, saga compensation handlers, and pause/resume via external events. Backed by a Durable Object so each execution survives Worker restarts and CPU limits.

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
  retry: { maxAttempts: 3, initialDelay: "1s", maxDelay: "30s", backoffMultiplier: 2 },
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
const result = await handle.result();  // resolves when the workflow terminates
```

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

## Pause / resume

```ts
.step("await-approval", async (input, _prev, ctx) => {
  ctx.waitFor({ event: "approval-decision", timeout: "24h" });
  // execution suspends; the DO releases the request CPU
})
```

Resume from outside:

```ts
const handle = orderFlow.execution(executionId);
await handle.resume("approval-decision", { approved: true });
```

The journal records `waiting` state so cold-start replay knows to skip past the suspended step.

## Status, journal, cancel

```ts
const handle = orderFlow.execution(id);
await handle.status();   // "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting" | "sleeping"
await handle.journal();  // StepJournalEntry[] — full per-step audit trail
await handle.meta();     // ExecutionMeta — input, started/finished, attempts
await handle.cancel();   // marks cancelled; compensation runs
```

## Errors

All terminal failures throw `WorkflowError`:

```ts
type WorkflowError = Error & {
  executionId: string;
  failedStep: string;
  stepAttempt: number;
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

## Cloudflare Workflows backend

If you'd rather use the native Cloudflare Workflows product:

```ts
const flow = createDurableWorkflow("order-flow", {
  backend: { type: "cf-workflows", binding: env.WORKFLOWS },
});
```

Same builder API, different storage substrate. DO backend gives you fine-grained control; `cf-workflows` gives you longer step durations and managed retention.

## See also

- [Durable Objects](/workkit/guides/durable-objects/) — `@workkit/do` primitives that the DO backend builds on.
- [Approval Workflows](/workkit/guides/approval-workflows/) — pair `await-approval` steps with `@workkit/approval` for human-in-the-loop.
- [Queues and Crons](/workkit/guides/queues-and-crons/) — schedule workflow runs from cron triggers or queue messages.
