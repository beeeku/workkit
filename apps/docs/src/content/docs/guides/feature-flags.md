---
title: "Feature Flags"
---

# Feature Flags

`@workkit/features` is a KV-backed feature flag client for Cloudflare Workers — boolean rollouts, percentage rollouts (sticky per user via deterministic hashing), targeting rules, A/B variant assignment, and per-user overrides. No external service, no SDK pull.

## Install

```bash
bun add @workkit/features
```

## Quick start

```ts
import { createFlags } from "@workkit/features";

const flags = createFlags(env.FLAGS_KV, { prefix: "flags:", cacheTtl: 60 });

// Simple boolean check
const darkMode = await flags.isEnabled("dark-mode", { userId: "user-123" });

// Percentage rollout — sticky per user
await flags.setFlag("new-checkout", { key: "new-checkout", enabled: true, percentage: 25 });
const inRollout = await flags.isEnabled("new-checkout", { userId: "user-456" });

// A/B variant
const variant = await flags.getVariant("homepage-test", { userId: "user-456" });
// "control" | "blue" | "green" — based on variant weights
```

## Flag definitions

A flag is a JSON document stored in KV under `<prefix><key>`:

```ts
interface FlagDefinition {
  key: string;
  enabled: boolean;
  description?: string;
  /** 0–100, sticky per userId via deterministic hash */
  percentage?: number;
  /** Variant name → weight mapping for A/B */
  variants?: Record<string, number>;
  /** All rules must match (AND logic) for the flag to apply */
  targeting?: TargetingRule[];
  /** userId → forced boolean or variant override */
  overrides?: Record<string, boolean | string>;
}
```

### Targeting rules

```ts
interface TargetingRule {
  attribute: string;
  operator: "eq" | "neq" | "in" | "notIn" | "gt" | "lt" | "contains";
  values: (string | number)[];
}
```

```ts
await flags.setFlag("beta-feature", {
  key: "beta-feature",
  enabled: true,
  targeting: [
    { attribute: "plan", operator: "in", values: ["pro", "enterprise"] },
    { attribute: "country", operator: "eq", values: ["US"] },
  ],
});

const enabled = await flags.isEnabled("beta-feature", {
  userId: "user-1",
  plan: "pro",
  country: "US",
});
```

`FlagContext` accepts `userId` plus arbitrary `string | number | boolean` attributes.

### Overrides

Force a value for specific users — useful for QA, internal staff, or canary cohorts:

```ts
await flags.setFlag("new-search", {
  key: "new-search",
  enabled: false,
  overrides: { "user-staff-1": true, "user-staff-2": true },
});
```

## Hono middleware

```ts
import { Hono } from "hono";
import { featureFlags } from "@workkit/features";

const app = new Hono<{ Bindings: { FLAGS_KV: KVNamespace } }>();

app.use("*", featureFlags({ kv: (c) => c.env.FLAGS_KV }));

app.get("/checkout", async (c) => {
  const flags = c.get("flags");
  const useNew = await flags.isEnabled("new-checkout", { userId: c.req.header("x-user-id") });
  return c.text(useNew ? "v2" : "v1");
});
```

## Caching

Reads are cached in-process for `cacheTtl` seconds (default 60). The cache is per-isolate, so a Worker that gets recycled re-fetches from KV on the first read. For lower-latency reads after a flip, set `cacheTtl: 0` and rely on KV's edge cache.

## Determinism

`deterministicHash(input)` is FNV-1a — same input always produces the same hash. This is what makes percentage rollouts sticky: a user either always sees the variant or always doesn't, even across cold starts. The hash key is `<flagKey>:<userId>` so the same user can be in 25% of rollout A and 75% of rollout B independently.

## API

```ts
interface FlagClient {
  isEnabled(key: string, context?: FlagContext): Promise<boolean>;
  getVariant(key: string, context?: FlagContext): Promise<string | null>;
  getAllFlags(context?: FlagContext): Promise<Map<string, boolean>>;
  setFlag(key: string, definition: FlagDefinition): Promise<void>;
  deleteFlag(key: string): Promise<void>;
  listFlags(): Promise<FlagDefinition[]>;
}
```

## See also

- [KV Patterns](/workkit/guides/kv-patterns/) — `@workkit/kv` is the underlying storage.
- [Authentication](/workkit/guides/authentication/) — pull `userId` from `@workkit/auth` to drive targeting.
