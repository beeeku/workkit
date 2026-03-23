# workkit

## 0.2.0

### Minor Changes

- ### @workkit/logger (new package)

  Structured logging for Cloudflare Workers with the best DX in the ecosystem.

  - `createLogger()` for standalone use in queues, crons, and Durable Objects
  - `logger()` Hono middleware — auto-attaches to every request with route exclusion
  - `getLogger(c)` — request-scoped logger with automatic context via AsyncLocalStorage
  - Child loggers with `log.child({ userId })` for persistent field inheritance
  - Log levels (debug, info, warn, error) with configurable minimum level
  - Structured JSON output — Workers Logs auto-indexes all fields
  - Built-in redaction for sensitive fields
  - Zero runtime dependencies, hono as optional peer

  ### workkit CLI

  - Interactive mode: `npx workkit init` now shows a shadcn-style wizard with template picker and feature multi-select via @clack/prompts
  - New `workkit add` command: install @workkit packages into existing projects
  - Full backward compatibility — all flag-based usage works unchanged

## 0.1.1

### Patch Changes

- Fix workspace:_ dependencies leaking into published packages. Added resolve script to replace workspace:_ with actual semver versions before npm publish.

## 0.1.0

### Minor Changes

- First stable release of the workkit Cloudflare Workers utility suite.

  ### Highlights

  - **18 packages** covering the full Cloudflare Workers API surface: KV, D1, R2, Queues, Durable Objects, Cron, Cache, Rate Limiting, Crypto, AI, AI Gateway, API routing, Auth, and Environment validation
  - **3 framework integrations**: Hono, Astro, and Remix middleware with typed env and error handling
  - **CLI** (`npx workkit`): scaffolding, validation, migrations, seeding, client generation, and docs generation
  - **Testing utilities** (`@workkit/testing`): in-memory mocks for all Cloudflare bindings
  - **Zero runtime dependencies** — each package is self-contained with full TypeScript types
  - **Standard Schema support** — works with Zod, Valibot, or any Standard Schema compliant validator

  ### Fixes since 0.0.1

  - CLI now bundles internal dependencies (fixes `npx workkit` failing with protocol error)
  - All lint and a11y issues resolved
  - Full test coverage: 2,456+ unit tests, 245 e2e tests
  - Clean typecheck across all packages
