# @workkit/mcp

## 0.2.0

### Minor Changes

- 6b184a1: Wire the documented `openapi.swaggerUI` and `auth.handler` config that previously had no runtime effect.

  - `openapi.swaggerUI: true | { cdn?: false }` now registers `GET /docs` returning a Swagger UI shell that loads from a CDN and points at `/openapi.json`. Set `cdn: false` to opt out.
  - `auth.handler` is now invoked as a Hono `app.use("*")` middleware on every request whose pathname is not in `auth.exclude`. The handler receives `(request, env, next)` and may return an early `Response` (rejecting) or call `next()` to continue.

  Sessions (`config.session`) remain reserved for v0.2.x — see issue #46.

## 0.1.1

### Patch Changes

- Updated dependencies [2e8d7f1]
  - @workkit/errors@1.0.3
