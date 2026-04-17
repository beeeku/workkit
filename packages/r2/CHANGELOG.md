# @workkit/r2

## 0.2.0

### Minor Changes

- 9a52478: **Security fix**: `createPresignedUrl` now requires a `signingSecret` parameter.

  Previously the HMAC key was derived from the public URL payload itself, making
  the signature trivially forgeable by any caller who could read the URL. The
  signing secret must now be provided by the caller and kept server-side; the
  verifying Worker route must use the same secret.

  ```ts
  // Before (insecure — key was derived from the public payload)
  await createPresignedUrl(env.BUCKET, { key, method: "GET" });

  // After
  await createPresignedUrl(env.BUCKET, {
    key,
    method: "GET",
    signingSecret: env.PRESIGN_SECRET,
  });
  ```

## 0.1.1

### Patch Changes

- Fix workspace:_ dependencies leaking into published packages. Added resolve script to replace workspace:_ with actual semver versions before npm publish.
- Updated dependencies
  - @workkit/types@1.0.1
  - @workkit/errors@1.0.1

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

### Patch Changes

- Updated dependencies
  - @workkit/types@1.0.0
  - @workkit/errors@1.0.0
