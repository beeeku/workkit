---
"@workkit/mcp": minor
---

Wire the documented `openapi.swaggerUI` and `auth.handler` config that previously had no runtime effect.

- `openapi.swaggerUI: true | { cdn?: false }` now registers `GET /docs` returning a Swagger UI shell that loads from a CDN and points at `/openapi.json`. Set `cdn: false` to opt out.
- `auth.handler` is now invoked as a Hono `app.use("*")` middleware on every request whose pathname is not in `auth.exclude`. The handler receives `(request, env, next)` and may return an early `Response` (rejecting) or call `next()` to continue.

Sessions (`config.session`) remain reserved for v0.2.x — see issue #46.
