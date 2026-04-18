# @workkit/workflow

> Durable workflow execution on Cloudflare Workers — checkpoint, replay, retry, saga compensation.

[![npm](https://img.shields.io/npm/v/@workkit/workflow)](https://www.npmjs.com/package/@workkit/workflow)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/workflow)](https://bundlephobia.com/package/@workkit/workflow)

Multi-step orchestrations that survive Worker restarts and CPU limits. Each step is journaled in a Durable Object and replayed on cold start. Per-step retries with exponential backoff, saga-style `onFailure` compensation, and idempotency keys for safe retries against external systems.

## Install

```bash
bun add @workkit/workflow @workkit/errors
```

## Usage

```ts
import { createDurableWorkflow, WorkflowExecutionDO } from "@workkit/workflow";

export { WorkflowExecutionDO };

const orderFlow = createDurableWorkflow("order-flow", {
  backend: { type: "do", namespace: env.WORKFLOW_DO },
  retry: { maxAttempts: 3, initialDelay: 1_000, maxDelay: 30_000, backoffMultiplier: 2 },
  timeout: "10m",
})
  .step("reserve-inventory", async (input) => reserveInventory(input.orderId, input.items))
  .step("charge-card", async (input, prev) =>
    chargeCard(input.userId, input.amount, { reservationId: prev.reservationId }),
  )
  .step("ship", async (input, prev) => shipOrder(input.orderId, prev.transactionId))
  .onFailure(async (ctx) => {
    if (ctx.stepOutputs["charge-card"]) await refund(ctx.stepOutputs["charge-card"].transactionId);
    if (ctx.stepOutputs["reserve-inventory"]) await releaseInventory(ctx.stepOutputs["reserve-inventory"].reservationId);
  });

const handle = await orderFlow.run({ orderId: "o-1", userId: "u-1", amount: 99.99, items: [] });
const result = await handle.result();
if (result.ok) console.log("done", result.value);
else console.error(result.error.failedStep, result.error.message);
```

## Highlights

- Deterministic replay via per-step journal — handlers run exactly once under normal operation
- Per-step `idempotencyKey(input)` for safe retries against external systems
- Saga compensation via `onFailure` — undo committed work in reverse
- Per-step retry overrides; `retryable: false` shortcircuits
- Inspect `journal()`, `meta()`, and `status()` from `ExecutionHandle`

## v0.1.0 limitations

- `cf-workflows` backend is reserved but not implemented (throws "Only DO backend supported in v0.1.0")
- `ExecutionHandle.resume()` for external pause/resume is stubbed (throws "Not supported in v0.1.0")

## Documentation

Full guide: [workkit docs — Durable Workflows](https://beeeku.github.io/workkit/guides/durable-workflows/)
