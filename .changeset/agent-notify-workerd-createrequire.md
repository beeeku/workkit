---
"@workkit/agent": patch
"@workkit/notify": patch
---

**Fix module-init crash in workerd: drop top-level `createRequire(import.meta.url)` from the bundle.** Bunup's default Node-target build emitted a top-level `import { createRequire } from "node:module"; var __require = createRequire(import.meta.url);` shim. Under workerd, `import.meta.url` is `undefined` for non-entry-point modules, so `createRequire(undefined)` threw synchronously at module load — blocking any Cloudflare Worker that imported (directly or transitively) `@workkit/agent` or `@workkit/notify` from booting.

Both packages now build with `target: "browser"`, which switches bunup to a self-contained `__require` shim that has no top-level side effects. The shim only throws if a caller actually performs a dynamic `require()` — which neither package does. No source changes; no API changes.

Closes #64.
