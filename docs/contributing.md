# Contributing

## Monorepo Structure

```
workkit/
  packages/          # Core packages
    types/           # @workkit/types -- shared types, no deps
    errors/          # @workkit/errors -- error hierarchy, no deps
    env/             # @workkit/env -- env validation
    d1/              # @workkit/d1 -- D1 database wrapper
    kv/              # @workkit/kv -- KV store wrapper
    r2/              # @workkit/r2 -- R2 object storage wrapper
    queue/           # @workkit/queue -- Queue producer/consumer
    cache/           # @workkit/cache -- Cache API wrapper
    do/              # @workkit/do -- Durable Objects helpers
    cron/            # @workkit/cron -- Cron task router
    crypto/          # @workkit/crypto -- WebCrypto wrappers
    auth/            # @workkit/auth -- JWT, sessions, passwords
    ratelimit/       # @workkit/ratelimit -- Rate limiting strategies
    ai/              # @workkit/ai -- Workers AI client
    ai-gateway/      # @workkit/ai-gateway -- Multi-provider gateway
    api/             # @workkit/api -- API definition and routing
    testing/         # @workkit/testing -- Mock bindings
    cli/             # @workkit/cli -- CLI tool
  integrations/      # Framework adapters
    hono/            # @workkit/hono
    astro/           # @workkit/astro
    remix/           # @workkit/remix
  tooling/           # Internal build tools
  docs/              # Documentation
  e2e/               # End-to-end tests
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.2.0 (package manager and runtime)
- Node.js >= 18 (for some tooling)
- Git

## Getting Started

```bash
# Clone the repository
git clone https://github.com/your-org/workkit.git
cd workkit

# Install dependencies
bun install

# Build all packages
bun run build

# Run all tests
bun run test

# Type check
bun run typecheck

# Lint
bun run lint
```

## Development Workflow

### Running a Single Package

```bash
# Build one package
cd packages/kv
bun run build

# Test one package
cd packages/kv
bun test
```

### Using Turbo

The monorepo uses [Turborepo](https://turbo.build/) for build orchestration:

```bash
# Build everything (with caching)
bun run build

# Test everything
bun run test

# Type check everything
bun run typecheck

# These respect the dependency graph -- types and errors build first
```

### Running E2E Tests

```bash
bun run test:e2e
```

## Package Conventions

### File Structure

Every package follows this layout:

```
packages/my-package/
  src/
    index.ts          # Public API -- re-exports only
    types.ts          # Type definitions
    my-feature.ts     # Implementation
  tests/
    my-feature.test.ts
  package.json
  tsconfig.json
```

### `index.ts` is the Public API

The `index.ts` file should only contain re-exports. All implementation goes in separate files:

```ts
// Good -- index.ts
export { myFunction } from './my-feature'
export type { MyType } from './types'

// Bad -- don't put implementation in index.ts
```

### Type-Only Exports

Use `export type` for types to enable proper tree-shaking:

```ts
export type { MyType, MyOptions } from './types'
export { myFunction } from './my-feature'
```

### Error Handling

- Use errors from `@workkit/errors` -- do not create ad-hoc error classes
- All binding wrappers should throw `BindingNotFoundError` for null bindings
- Classify errors with context when possible

```ts
import { BindingNotFoundError } from '@workkit/errors'

export function myWrapper(binding: SomeBinding) {
  if (!binding) {
    throw new BindingNotFoundError('SomeBinding binding is null or undefined')
  }
  // ...
}
```

### Testing

- Use Vitest for all tests
- Use `@workkit/testing` mocks for integration tests
- Test both success and error paths
- Test edge cases (null bindings, empty inputs, boundary values)

```ts
import { describe, it, expect } from 'vitest'
import { createMockKV } from '@workkit/testing'

describe('myFeature', () => {
  it('handles the happy path', async () => {
    // ...
  })

  it('throws on null binding', () => {
    expect(() => myWrapper(null as any)).toThrow('BindingNotFoundError')
  })
})
```

### Documentation

- Every exported function should have a JSDoc comment with `@example`
- Types should have doc comments explaining their purpose
- Keep the API reference (`docs/api-reference.md`) up to date when adding exports

## Adding a New Package

1. Create the directory:

```bash
mkdir -p packages/my-package/src
```

2. Create `package.json`:

```json
{
  "name": "@workkit/my-package",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bunup src/index.ts --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@workkit/types": "workspace:*",
    "@workkit/errors": "workspace:*"
  }
}
```

3. Create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

4. Create `src/index.ts` with your public API.

5. Add the package to the workspace (it is auto-detected from `packages/*` in the root `package.json`).

6. Update `docs/api-reference.md` with the new package's exports.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning:

```bash
# Create a changeset
bun run changeset

# Version packages (CI usually does this)
bun run version-packages

# Publish (CI usually does this)
bun run release
```

When creating a changeset:
- `patch` -- Bug fixes, documentation
- `minor` -- New features, non-breaking additions
- `major` -- Breaking changes

## Code Style

- Biome for linting and formatting: `bun run lint`
- No semicolons (Biome config)
- Single quotes
- Tabs for indentation
- Explicit return types on exported functions
- Prefer `const` assertions and discriminated unions

## Design Principles

1. **Each package is independent.** No circular dependencies. Packages at the same layer should not depend on each other.

2. **Standard Schema over vendor lock-in.** Env validation accepts any Standard Schema validator. We do not re-export or depend on Zod, Valibot, or ArkType.

3. **Factory + Options pattern.** Every binding wrapper uses a factory function that returns a typed client. Options are always optional with sensible defaults.

4. **Errors carry retry guidance.** Never force consumers to guess whether an error is retryable or what strategy to use.

5. **Raw access escape hatch.** Every wrapper exposes `.raw` for the underlying Cloudflare binding. We do not hide the platform.

6. **Tree-shakeable.** No barrel files that pull in everything. Import what you use.
