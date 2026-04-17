# @workkit/logger

## 0.1.1

### Patch Changes

- 9a52478: Bump `@types/node` dev dependency from `^22.0.0` to `^25.0.0` to match the
  current LTS Node.js type definitions.

## 0.1.0

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
