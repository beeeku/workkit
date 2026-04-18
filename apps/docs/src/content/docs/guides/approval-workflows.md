---
title: "Approval Workflows"
---

# Approval Workflows

`@workkit/approval` is approval-as-infrastructure for Cloudflare Workers — declarative policies, signed approval tokens, audit trails, and Durable-Object-backed request state. Use it to gate cost-sensitive, risky, or regulated actions on a human-in-the-loop decision.

## Install

```bash
bun add @workkit/approval @workkit/crypto @workkit/errors hono
```

## Bindings

| Binding | Purpose |
|---|---|
| `DurableObjectNamespace` | Stores live approval requests (one DO per request) |
| `D1Database` | Append-only audit projection |
| `Queue` | Notification dispatch (channel adapters consume from this) |

You also need an Ed25519 keypair for token signing — generate it once with `generateApprovalKeys()` and store the keys as secrets.

## Quick start

```ts
import { createApprovalGate, ApprovalRequestDO } from "@workkit/approval";
import { importSigningKey, importVerifyingKey } from "@workkit/crypto";

// Re-export the DO from your worker so the binding can find it.
export { ApprovalRequestDO };

export default {
  async fetch(req: Request, env: Env) {
    const gate = createApprovalGate({
      storage: env.APPROVAL_DO,
      audit: env.DB,
      notificationQueue: env.APPROVAL_QUEUE,
      signingKey: {
        privateKey: await importSigningKey(env.APPROVAL_PRIVATE_KEY),
        publicKey: await importVerifyingKey(env.APPROVAL_PUBLIC_KEY),
      },
      baseUrl: "https://api.example.com",
    });

    gate.policy("high_spend", {
      match: { type: "cost", greaterThanOrEqual: 1000, currency: "USD" },
      approvers: { group: "finance" },
      requiredApprovals: 2,
      timeout: "24h",
      onTimeout: "deny",
      segregateRequester: true,
    });

    const result = await gate.guard(
      { name: "wire-transfer", requestedBy: "user-1", cost: { amount: 5000, currency: "USD" } },
      { identity: "user-1" },
    );

    if (result.status === "approved") return Response.json({ ok: true });
    if (result.status === "pending") return Response.json({ requestId: result.requestId }, { status: 202 });
    return Response.json({ error: result.reason }, { status: 403 });
  },
};
```

## Policies

`gate.policy(name, definition)` registers a policy. Policies match on `ActionDescriptor` shape:

```ts
type ActionDescriptor = {
  name: string;
  requestedBy: string;
  cost?: { amount: number; currency: string };
  risk?: "low" | "medium" | "high" | "critical";
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

Matchers compose:

```ts
gate.policy("risky-prod", {
  match: {
    type: "all",
    matchers: [
      { type: "risk", minLevel: "high" },
      { type: "tag", anyOf: ["production", "customer-data"] },
    ],
  },
  approvers: [{ role: "sre-lead" }, { role: "security" }],
  requiredApprovals: 2,
  escalation: [{ group: "engineering-directors" }],
  escalationInterval: "4h",
  timeout: "24h",
});
```

Available matchers: `tag`, `cost`, `risk`, `name` (glob), `custom` (predicate fn), and `all`/`any` composites.

## Decisions

The gate exposes `decide(requestId, { token, action, reason? })` to record approver responses. Tokens are Ed25519-signed and single-use per `(approverId, requestId, action)`. The library:

- Verifies signature, expiry, and replay.
- Enforces `segregateRequester` — the requester cannot self-approve.
- Tracks `requiredApprovals` and transitions state to `approved`, `denied`, `escalated`, or `timed_out`.
- Writes every state change to the D1 audit projection.

## Notification channels

```ts
gate.channel({
  name: "slack",
  send: async (payload) => {
    await fetch(env.SLACK_WEBHOOK, { method: "POST", body: JSON.stringify(payload) });
  },
});
```

Channel adapters live in `@workkit/approval/channels` (Slack, email-via-`@workkit/notify`, webhook). Channels run inside the queue consumer — failures retry through standard queue semantics.

## Audit

```ts
import { createAuditProjection } from "@workkit/approval";

const audit = createAuditProjection(env.DB);
const entries = await audit.list({ requestId: "req_..." });
```

Audit rows are append-only and include the resolved policy, approver, decision, reason, and timestamps.

## Security defaults

- **Tokens are Ed25519-signed.** Never accept an unsigned approver payload — always go through `decide()`.
- **`segregateRequester` defaults off.** Set it on for any policy where self-approval is unsafe.
- **Replay protection.** Each token hash is recorded on the request DO; reuse rejects.
- **`baseUrl` is optional but recommended** — channel templates use it to render approve/deny deep links.
- **Audit is append-only.** Storage rules in your D1 schema should match — never `UPDATE` or `DELETE` audit rows.

## See also

- [Authentication](/workkit/guides/authentication/) — pair with `@workkit/auth` to identify the approver.
- [Notifications](/workkit/guides/notifications/) — use `@workkit/notify` as a channel adapter for approval notifications.
- [Durable Workflows](/workkit/guides/durable-workflows/) — combine with `@workkit/workflow` for multi-step orchestrations that include approval gates.
