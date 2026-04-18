# @workkit/approval

> Approval-as-Infrastructure for Cloudflare Workers — declarative policies, signed tokens, audit trails.

[![npm](https://img.shields.io/npm/v/@workkit/approval)](https://www.npmjs.com/package/@workkit/approval)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/approval)](https://bundlephobia.com/package/@workkit/approval)

Gate cost-sensitive, risky, or regulated actions on a human-in-the-loop decision. Per-request Durable Object for live state, D1 audit projection, Ed25519-signed approval tokens with replay protection.

## Install

```bash
bun add @workkit/approval @workkit/crypto @workkit/errors hono
```

## Usage

```ts
import { createApprovalGate, ApprovalRequestDO } from "@workkit/approval";
import { importSigningKey } from "@workkit/crypto";

export { ApprovalRequestDO };

const gate = createApprovalGate({
  storage: env.APPROVAL_DO,
  audit: env.DB,
  notificationQueue: env.APPROVAL_QUEUE,
  signingKey: {
    privateKey: await importSigningKey(env.PRIVATE_KEY, "private"),
    publicKey: await importSigningKey(env.PUBLIC_KEY, "public"),
  },
});

gate.policy("high_spend", {
  match: { type: "cost", greaterThanOrEqual: 1000, currency: "USD" },
  approvers: { group: "finance" },
  requiredApprovals: 2,
  timeout: "24h",
  segregateRequester: true,
});

const result = await gate.guard(
  { name: "wire-transfer", requestedBy: "user-1", cost: { amount: 5000, currency: "USD" } },
  { identity: "user-1" },
);
```

## Highlights

- Declarative policies — match by `tag`, `cost`, `risk`, `name`, `custom` predicate, or `all`/`any` composites
- Approver specs — explicit lists, `{ group }`, `{ role }`, or async resolver
- Multi-step escalation, `requiredApprovals`, `segregateRequester`, `onTimeout` callbacks
- Ed25519 token signing with single-use enforcement and replay protection
- Append-only D1 audit projection
- Channel adapters via `@workkit/approval/channels` — Slack, webhook, `@workkit/notify`

## Documentation

Full guide: [workkit docs — Approval Workflows](https://beeeku.github.io/workkit/guides/approval-workflows/)
