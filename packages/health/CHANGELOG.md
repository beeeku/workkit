# @workkit/health

## 0.1.0

### Minor Changes

- New package: Health checks and dependency probes for Cloudflare Workers
  bindings. Built-in probes for KV, D1, R2, AI, DO, and Queue with concurrent
  execution, per-probe timeouts, critical vs optional classification, and a
  Hono `healthHandler()` returning structured JSON (200/503).
