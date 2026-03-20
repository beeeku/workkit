# @workkit/env

> Type-safe environment variable validation for Cloudflare Workers using Standard Schema

[![npm](https://img.shields.io/npm/v/@workkit/env)](https://www.npmjs.com/package/@workkit/env)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/env)](https://bundlephobia.com/package/@workkit/env)

## Install

```bash
bun add @workkit/env
```

## Usage

### Before (raw env access)

```ts
export default {
  async fetch(request, env) {
    const key = env.API_KEY // string | undefined — no validation, no types
    const port = parseInt(env.PORT) // NaN? empty string? who knows
    if (!key) throw new Error("API_KEY is required")
  },
}
```

### After (workkit env)

```ts
import { parseEnvSync } from "@workkit/env"
import { z } from "zod"

const schema = {
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(8080),
  DEBUG: z.enum(["true", "false"]).default("false"),
}

export default {
  async fetch(request, env) {
    const config = parseEnvSync(env, schema)
    // config.API_KEY — string (validated, required)
    // config.PORT — number (coerced, defaults to 8080)
    // config.DEBUG — "true" | "false" (enum, defaults to "false")
  },
}
```

Works with any Standard Schema provider: Zod, Valibot, ArkType.

## API

- **`parseEnv(rawEnv, schema)`** — Async validation. Validates all fields in parallel, collects all issues before throwing.
- **`parseEnvSync(rawEnv, schema)`** — Sync validation. Throws if any validator is async.
- **`createEnvParser(schema)`** — Returns a reusable `{ parse, parseSync }` object.
- **`EnvValidationError`** — Thrown on validation failure with all issues collected.
- **`detectPlatform()`** — Detect runtime (`workers`, `node`, `bun`, `deno`).
- **`resolveEnv()`** — Get the environment object for the current platform.

## License

MIT
