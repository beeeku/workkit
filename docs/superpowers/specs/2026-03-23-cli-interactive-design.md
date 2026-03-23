# workkit CLI Interactive Redesign — Design Spec

## Goal

Transform the workkit CLI from a fully declarative tool into an interactive, shadcn-inspired experience. Developers run `npx workkit init` and get a beautiful picker for templates, features, and configuration — similar to `npx shadcn@latest init` or `npm create astro`.

Existing flag-based usage continues to work for CI/scripting.

## Design Principles

1. **Interactive by default** — Running `workkit init` with no flags launches the interactive wizard
2. **Flags skip prompts** — Any flag provided skips that question (progressive disclosure)
3. **Beautiful terminal UI** — Use @clack/prompts for consistent, polished prompts
4. **shadcn-style `add` command** — `workkit add kv d1 auth` installs individual packages into an existing project
5. **Backward compatible** — All existing flag-based commands still work unchanged

## New Commands

### `workkit init` (Enhanced)

Interactive mode when run without flags:

```
┌  workkit — Create a new Cloudflare Workers project
│
◆  What's your project name?
│  my-worker
│
◆  Which template?
│  ○ Basic — Minimal fetch handler
│  ● Hono — Hono framework with typed routes (recommended)
│  ○ API — Structured API with router and handlers
│
◆  Which packages do you want?
│  ◻ @workkit/env — Type-safe environment validation
│  ◼ @workkit/kv — Typed KV with serialization
│  ◼ @workkit/d1 — Typed D1 with query builder
│  ◻ @workkit/r2 — R2 storage with streaming
│  ◻ @workkit/cache — SWR and cache patterns
│  ◻ @workkit/queue — Typed queue producer/consumer
│  ◻ @workkit/cron — Declarative cron handlers
│  ◼ @workkit/auth — JWT and session management
│  ◻ @workkit/ratelimit — KV-backed rate limiting
│  ◻ @workkit/ai — Workers AI with streaming
│  ◻ @workkit/logger — Structured request logging
│
◆  Install dependencies?
│  ● Yes / ○ No
│
└  Done! Created my-worker with Hono + KV + D1 + Auth

  Next steps:
  cd my-worker
  bun run dev
```

### `workkit add` (New)

shadcn-style package installer for existing projects:

```bash
# Interactive — pick from a list
workkit add

# Direct — install specific packages
workkit add kv d1 auth

# With auto-config — updates wrangler.toml bindings
workkit add d1 --configure
```

```
┌  workkit add — Add packages to your project
│
◆  Which packages do you want to add?
│  ◼ @workkit/kv
│  ◼ @workkit/d1
│  ◻ @workkit/r2
│  ...
│
◆  Configure wrangler.toml bindings? (recommended)
│  ● Yes / ○ No
│
└  Added @workkit/kv, @workkit/d1
   Updated wrangler.toml with KV and D1 bindings
   Updated src/env.ts with binding types
```

## Tech Stack

- **@clack/prompts** — Terminal UI (same as Astro, SvelteKit, etc.)
- **picocolors** — Colored output (already using custom colors, swap to standard lib)

## Architecture

```
packages/cli/
  src/
    index.ts              — Entry point, command router
    commands/
      init.ts             — Enhanced init with interactive mode
      add.ts              — New add command
      check.ts            — Existing (unchanged)
      d1/migrate.ts       — Existing (unchanged)
      d1/seed.ts          — Existing (unchanged)
      gen/client.ts       — Existing (unchanged)
      gen/docs.ts         — Existing (unchanged)
      catalog.ts          — Enhanced with install status
    prompts/
      project-name.ts     — Name prompt with validation
      template-select.ts  — Template picker
      feature-select.ts   — Multi-select feature picker
      confirm.ts          — Yes/No prompts
    utils.ts              — Shared utilities (existing)
    templates.ts          — Template definitions (existing, enhanced)
```

## Interactive Flow Logic

```
workkit init
  ├── Has --name flag? → Skip name prompt
  ├── Has --template flag? → Skip template prompt
  ├── Has --features flag? → Skip features prompt
  └── All flags provided? → Skip all prompts (CI mode)
```

Each prompt is skippable independently. Partial flags work:
- `workkit init --template hono` → asks name and features
- `workkit init --name my-app --template hono --features env,d1` → no prompts

## `workkit add` Logic

1. Detect if in a workkit project (check for `@workkit/*` in package.json)
2. Show multi-select of available packages (excluding already installed)
3. Install selected packages via `bun add` / `npm install`
4. If `--configure`:
   - Read `wrangler.toml`
   - Add missing binding sections for selected packages
   - Update env type definitions if they exist

## Template Enhancements

Each template gets a one-line description shown in the picker:

| Template | Description |
|----------|-------------|
| basic | Minimal fetch handler — start from scratch |
| hono | Hono framework with typed routes (recommended) |
| api | Structured API with router, handlers, and OpenAPI |

## Dependencies Change

```json
{
  "dependencies": {
    "@clack/prompts": "^0.9.0",
    "picocolors": "^1.1.0"
  }
}
```

These are bundled into the CLI binary (not external), so end users don't install them separately.

## Backward Compatibility

- All existing flags continue to work unchanged
- `workkit init --template hono --features env,d1 --name my-app --dir .` works exactly as before
- Interactive mode only activates when flags are missing
- CI environments (detected via `CI=true` or `--no-interactive`) skip prompts with sensible defaults

## Testing Strategy

- Unit tests for each prompt module
- Integration test: mock stdin to simulate interactive selections
- Existing init tests continue to pass (flag-based mode)
- Test partial flag combinations (some interactive, some provided)
