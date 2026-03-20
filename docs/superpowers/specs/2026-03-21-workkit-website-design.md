# workkit.bika.sh — Website Design Spec

**Date**: 2026-03-21
**Status**: Approved
**Goal**: Developer adoption + brand building (TanStack-level quality)

## Architecture

Two deployments, one monorepo:

### 1. Docs Site — Cloudflare Pages (`apps/docs/`)
- **Framework**: Astro + Starlight
- **Styling**: Tailwind CSS + shadcn/ui
- **Integration**: `@workkit/astro` (dogfooding)
- **Content**: Existing 16 markdown docs (symlinked from `docs/`)
- **Custom pages**: Landing, playground UI, comparison pages
- **Domain**: workkit.bika.sh

### 2. API Worker — Cloudflare Worker (`apps/api/`)
- **Framework**: Hono via `@workkit/hono`
- **Bindings**: D1 (snippets, analytics), KV (caching), R2 (assets), AI (chatbot demo)
- **Packages used**: `@workkit/hono`, `@workkit/env`, `@workkit/d1`, `@workkit/kv`, `@workkit/r2`, `@workkit/ai`, `@workkit/ratelimit`, `@workkit/errors`, `@workkit/cache`
- **Purpose**: Playground execution, live demo backends, analytics

## Site Map

| Route | Type | Description |
|-------|------|-------------|
| `/` | Custom Astro page | Landing — hero, package grid, code examples, "built with workkit" |
| `/docs/*` | Starlight | Getting started, 10 guides, API reference, migration, contributing |
| `/playground` | Custom Astro page | Guided examples with editable code + real Worker execution |
| `/compare` | Custom Astro page | Before/after (raw CF vs workkit) + feature matrix grid |
| `/demo/api` | Worker route | Live REST API — hit real endpoints, see responses |
| `/demo/chat` | Worker route | AI chatbot — streaming responses with rate limiting |

## Playground Design (Phase 1 — Guided Examples)

Three-panel layout:
1. **Sidebar** (left): 8 example entries from existing `examples/` directory
2. **Editor** (center): Monaco editor with workkit packages. Before/after toggle (workkit code vs raw Cloudflare API)
3. **Output** (right): Response panel with Run button

How it works:
- User selects an example from the sidebar
- Code loads in the editor (editable)
- User clicks Run → code is sent to the API Worker
- API Worker executes the code in a sandboxed context with real bindings (KV, D1, R2)
- Response displayed in the output panel
- Each example links to its corresponding docs page

### Examples (from existing `examples/` directory)
1. Basic Worker — env + KV
2. REST API — Hono + D1 + JWT + errors
3. Queue Worker — producer/consumer + dead letters
4. Cron Tasks — scheduled tasks + state tracking
5. AI Chatbot — streaming AI + rate limiting + caching
6. File Upload — R2 + presigned URLs
7. Realtime Counter — Durable Objects state machine
8. Full Stack App — 9 packages combined

### Phase 2 (future)
Free-form editor where users write arbitrary Worker code. Guided examples become starter templates.

## Comparison Pages

### Before/After (per package)
Side-by-side code comparison: raw Cloudflare API (left, red) vs workkit (right, green). Content sourced from existing BEFORE/AFTER comments in example files. One section per package.

### Feature Matrix
TanStack-style comparison grid:

| Feature | workkit | Raw CF APIs | worktop | flarekit | superflare |
|---------|---------|------------|---------|----------|------------|
| Typed KV | ✓ | ✗ | ✗ | ~ | ✗ |
| Env validation | ✓ | ✗ | ✗ | ✗ | ✗ |
| ... | ... | ... | ... | ... | ... |

Covers all 18 packages vs alternatives. Research needed to fill in competitor columns accurately.

## Live Demos

### REST API Demo (`/demo/api`)
- Deployed Worker running the `rest-api` example
- Interactive API explorer on the page — users pick an endpoint, see the request/response
- Packages demonstrated: `@workkit/hono`, `@workkit/d1`, `@workkit/auth`, `@workkit/errors`, `@workkit/api`

### AI Chatbot Demo (`/demo/chat`)
- Deployed Worker using Workers AI
- Chat interface on the page — streaming responses
- Rate limiting visible (shows remaining requests)
- Packages demonstrated: `@workkit/ai`, `@workkit/ratelimit`, `@workkit/cache`, `@workkit/hono`

## Dogfooding Summary

10 out of 18 `@workkit/*` packages used in production:

| Package | Used For |
|---------|----------|
| `@workkit/astro` | Docs site integration |
| `@workkit/hono` | API Worker routing |
| `@workkit/env` | Config validation |
| `@workkit/d1` | Snippets storage, analytics |
| `@workkit/kv` | Response caching |
| `@workkit/r2` | Static assets |
| `@workkit/ai` | Chatbot demo |
| `@workkit/ratelimit` | API + demo abuse protection |
| `@workkit/errors` | Structured error responses |
| `@workkit/cache` | Cache layer |

Footer badge: **"This site is built with workkit"**

## Monorepo Structure

```
workkit/
├── packages/          # existing 18 packages
├── integrations/      # existing 3 integrations
├── examples/          # existing 8 examples
├── apps/
│   ├── docs/          # Astro + Starlight site
│   │   ├── astro.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── src/
│   │   │   ├── content/docs/   # symlink → ../../docs/
│   │   │   ├── pages/          # landing, playground, compare
│   │   │   └── components/     # shadcn/ui components
│   │   └── public/
│   └── api/           # Hono Worker backend
│       ├── src/
│       │   ├── index.ts        # Hono app entry
│       │   ├── routes/         # playground, demos, analytics
│       │   └── lib/            # sandbox, db schema
│       └── wrangler.toml       # D1, KV, R2, AI bindings
└── turbo.json         # updated with apps/* pipeline
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Docs framework | Astro + Starlight |
| Styling | Tailwind CSS + shadcn/ui |
| Code editor | Monaco Editor (via @monaco-editor/react) |
| API framework | Hono via @workkit/hono |
| Database | Cloudflare D1 |
| Cache | Cloudflare KV |
| Assets | Cloudflare R2 |
| AI | Cloudflare Workers AI |
| Hosting | Cloudflare Pages + Workers |
| Domain | workkit.bika.sh |

## Implementation Phases

### Phase 1: Foundation
- Scaffold `apps/docs/` with Astro + Starlight
- Configure Tailwind + shadcn/ui
- Import existing markdown docs
- Build landing page
- Deploy to workkit.bika.sh

### Phase 2: API Worker + Playground
- Scaffold `apps/api/` with Hono
- Configure D1, KV, R2, AI bindings
- Build playground execution endpoint
- Build playground UI (sidebar, editor, output)
- Wire before/after toggle

### Phase 3: Comparisons + Demos
- Build comparison pages (before/after per package)
- Build feature matrix page
- Deploy REST API demo
- Deploy AI chatbot demo
- Build demo UI pages

### Phase 4: Polish
- SEO, Open Graph, social cards
- Performance optimization
- Analytics integration
- "Built with workkit" footer badge
