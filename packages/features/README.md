# @workkit/features

> KV-backed feature flags for Cloudflare Workers — boolean toggles, percentage rollouts, targeting rules, A/B variants, per-user overrides.

[![npm](https://img.shields.io/npm/v/@workkit/features)](https://www.npmjs.com/package/@workkit/features)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/features)](https://bundlephobia.com/package/@workkit/features)

No external service. Flag definitions are JSON in KV, evaluated locally with deterministic hashing for sticky rollouts.

## Install

```bash
bun add @workkit/features
```

## Usage

```ts
import { createFlags } from "@workkit/features";

const flags = createFlags(env.FLAGS_KV, { prefix: "flags:", cacheTtl: 60 });

await flags.setFlag("dark-mode", {
  key: "dark-mode",
  enabled: true,
  percentage: 25,
  overrides: { "user-staff-1": true },
  targeting: [{ attribute: "plan", operator: "in", values: ["pro", "enterprise"] }],
});

const enabled = await flags.isEnabled("dark-mode", { userId: "user-1", plan: "pro" });
const variant = await flags.getVariant("homepage-test", { userId: "user-1" });
```

## Hono middleware

```ts
import { featureFlags } from "@workkit/features";

app.use("*", featureFlags({ kv: (c) => c.env.FLAGS_KV }));
app.get("/page", async (c) => {
  const flags = c.get("flags");
  return c.text((await flags.isEnabled("v2", { userId: c.req.header("x-user-id") })) ? "v2" : "v1");
});
```

## Highlights

- Percentage rollouts sticky per user via FNV-1a hash of `<flagKey>:<userId>`
- Targeting operators: `eq`, `neq`, `in`, `notIn`, `gt`, `lt`, `contains` — all rules AND
- Variant weighting for A/B (and N-arm) tests
- Per-user `overrides` for staff/QA/canary
- In-process cache layer over KV (configurable TTL)

## Documentation

Full guide: [workkit docs — Feature Flags](https://beeeku.github.io/workkit/guides/feature-flags/)
