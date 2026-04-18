---
"workkit": patch
---

**`workkit init` now pins `@workkit/*` versions instead of `"latest"`.** Previously the scaffolded `package.json` used `"latest"` for every workkit package, which made installs non-reproducible (each `bun install` could resolve a different version) and silently pulled breaking releases into existing projects.

Scaffolded dependencies are now pinned to `^<current-version>` of whatever CLI version the user has installed. A new `sync-versions.ts` prebuild script reads the monorepo's current package versions and regenerates `src/versions.ts`, so the CLI ships with an accurate map every release.

Unknown packages still fall back to `"latest"` so forward-compat doesn't wedge if the map is stale.
