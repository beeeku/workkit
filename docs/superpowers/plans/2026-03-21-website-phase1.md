# Website Phase 1: Foundation + Docs + Landing Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the workkit docs site with Starlight, Tailwind, shadcn/ui, and a custom landing page to beeeku.github.io/workkit.

**Architecture:** Astro + Starlight docs site in `apps/docs/`, deployed as static site to Cloudflare Pages. Existing 16 markdown docs imported via Starlight content collections. Custom landing page at `/` with hero, package grid, and code examples. Docs served under `/docs/`.

**Tech Stack:** Astro 5+, Starlight, Tailwind CSS 3, React islands, TypeScript, Cloudflare Pages (static)

**Spec:** `docs/superpowers/specs/2026-03-21-workkit-website-design.md` (on `feat/website-spec` branch)

---

## File Structure

```
apps/docs/
├── package.json                    # Astro project deps
├── astro.config.mjs                # Starlight + Tailwind config
├── tailwind.config.ts              # Tailwind configuration
├── tsconfig.json                   # TypeScript config
├── src/
│   ├── content/
│   │   └── docs/                   # Starlight content collection
│   │       ├── getting-started.md  # Copied from docs/getting-started.md
│   │       ├── architecture.md     # Copied from docs/architecture.md
│   │       ├── api-reference.md    # Copied from docs/api-reference.md
│   │       ├── migration.md        # Copied from docs/migration.md
│   │       ├── contributing.md     # Copied from docs/contributing.md
│   │       └── guides/             # Copied from docs/guides/
│   │           ├── env-validation.md
│   │           ├── database.md
│   │           ├── kv-patterns.md
│   │           ├── authentication.md
│   │           ├── rate-limiting.md
│   │           ├── ai-integration.md
│   │           ├── testing.md
│   │           ├── error-handling.md
│   │           ├── queues-and-crons.md
│   │           └── durable-objects.md
│   ├── pages/
│   │   └── index.astro             # Custom landing page (not Starlight)
│   ├── components/
│   │   ├── Landing.tsx             # Landing page React component (shadcn)
│   │   ├── PackageGrid.tsx         # Package cards grid
│   │   ├── CodeExample.tsx         # Before/after code snippet
│   │   └── ui/                     # shadcn/ui primitives (card, badge, button)
│   ├── styles/
│   │   └── global.css              # Tailwind imports + custom styles
│   └── assets/
│       └── workkit-logo.svg        # Logo
├── public/
│   └── favicon.svg
└── wrangler.toml                   # Cloudflare Pages config (optional, for preview)
```

Also modified:
- `package.json` (root) — add `apps/*` to workspaces
- `turbo.json` — add `dev` task for local development

---

### Task 1: Update Monorepo Config for apps/

**Files:**
- Modify: `package.json` (root)
- Modify: `turbo.json`

- [ ] **Step 1: Add apps/* to workspaces**

In root `package.json`, update workspaces:
```json
"workspaces": ["packages/*", "integrations/*", "tooling/*", "apps/*"]
```

- [ ] **Step 2: Add dev task to turbo.json**

Add a `dev` task for local development servers:
```json
{
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": { ... }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json turbo.json
git commit -m "chore: add apps/* workspace and dev task for website"
```

---

### Task 2: Scaffold Astro + Starlight Project

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/astro.config.mjs`
- Create: `apps/docs/tsconfig.json`

- [ ] **Step 1: Create apps/docs directory and package.json**

```json
{
  "name": "@workkit/docs",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "astro check"
  },
  "dependencies": {
    "@astrojs/react": "^4.2.0",
    "@astrojs/starlight": "^0.33.0",
    "@astrojs/starlight-tailwind": "^3.0.0",
    "@astrojs/tailwind": "^6.0.0",
    "astro": "^5.7.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

> **Note to implementer:** Check latest compatible versions before installing. Run `bun add astro @astrojs/starlight @astrojs/react @astrojs/tailwind @astrojs/starlight-tailwind tailwindcss react react-dom` and let bun resolve versions. The versions above are approximate. No adapter needed — this is a static site.

- [ ] **Step 2: Create astro.config.mjs**

```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://beeeku.github.io',
  integrations: [
    starlight({
      title: 'workkit',
      description: 'Composable utilities for Cloudflare Workers. Think TanStack for Workers.',
      social: {
        github: 'https://github.com/beeeku/workkit',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Reference', slug: 'api-reference' },
            { label: 'Migration', slug: 'migration' },
            { label: 'Contributing', slug: 'contributing' },
          ],
        },
      ],
      customCss: ['./src/styles/global.css'],
    }),
    tailwind({ applyBaseStyles: false }),
    react(),
  ],
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd apps/docs && bun install
```

- [ ] **Step 5: Commit**

```bash
git add apps/docs/package.json apps/docs/astro.config.mjs apps/docs/tsconfig.json
git commit -m "feat(docs): scaffold Astro + Starlight project"
```

---

### Task 3: Configure Tailwind + Global Styles

**Files:**
- Create: `apps/docs/tailwind.config.ts`
- Create: `apps/docs/src/styles/global.css`

- [ ] **Step 1: Create tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';
import starlightPlugin from '@astrojs/starlight-tailwind';

export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  plugins: [starlightPlugin()],
} satisfies Config;
```

- [ ] **Step 2: Create global.css**

```css
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

/* Starlight overrides for workkit branding */
:root {
  --sl-color-accent-low: #1e1b4b;
  --sl-color-accent: #7dd3fc;
  --sl-color-accent-high: #bae6fd;
  --sl-color-white: #ffffff;
  --sl-color-gray-1: #eceef2;
  --sl-color-gray-2: #c0c2c7;
  --sl-color-gray-3: #888b96;
  --sl-color-gray-4: #545861;
  --sl-color-gray-5: #353841;
  --sl-color-gray-6: #24272f;
  --sl-color-black: #17181c;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/docs/tailwind.config.ts apps/docs/src/styles/global.css
git commit -m "feat(docs): configure Tailwind CSS with Starlight theme"
```

---

### Task 4: Import Documentation Content

**Files:**
- Create: `apps/docs/src/content/docs/index.mdx`
- Create: `apps/docs/src/content/docs/getting-started.md` (+ all other docs)

- [ ] **Step 1: Copy markdown docs with frontmatter**

For each doc file, copy it to `apps/docs/src/content/docs/` and add Starlight frontmatter (`title` and optionally `description`). The existing markdown content stays unchanged — just prepend frontmatter.

**Script approach** — create a small script to automate this:
```bash
# For each doc, add frontmatter if missing and copy
for f in docs/getting-started.md docs/architecture.md docs/api-reference.md docs/migration.md docs/contributing.md; do
  name=$(basename "$f")
  # Extract title from first # heading
  title=$(grep -m1 "^# " "$f" | sed 's/^# //')
  mkdir -p apps/docs/src/content/docs
  echo "---"$'\n'"title: $title"$'\n'"---"$'\n' | cat - "$f" > "apps/docs/src/content/docs/$name"
done

# Copy guides
mkdir -p apps/docs/src/content/docs/guides
for f in docs/guides/*.md; do
  name=$(basename "$f")
  title=$(grep -m1 "^# " "$f" | sed 's/^# //')
  echo "---"$'\n'"title: $title"$'\n'"---"$'\n' | cat - "$f" > "apps/docs/src/content/docs/guides/$name"
done
```

> **Note to implementer:** Verify each file has proper frontmatter after copying. Some docs may already have frontmatter — don't duplicate it. Check with `head -3` on each file.

- [ ] **Step 2: Add .gitignore for Astro**

Create `apps/docs/.gitignore`:
```
dist/
.astro/
node_modules/
```

- [ ] **Step 3: Verify docs render**

```bash
cd apps/docs && bun run dev
```

Open http://localhost:4321/docs/ — verify sidebar shows all sections and pages render correctly.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/src/content/
git commit -m "feat(docs): import all markdown documentation into Starlight"
```

---

### Task 5: Build Landing Page

**Files:**
- Create: `apps/docs/src/pages/index.astro`
- Create: `apps/docs/src/components/Landing.tsx`
- Create: `apps/docs/src/components/PackageGrid.tsx`
- Create: `apps/docs/src/components/CodeExample.tsx`
- Create: `apps/docs/public/favicon.svg`

- [ ] **Step 1: Create landing page shell (Astro)**

Create `apps/docs/src/pages/index.astro`:
```astro
---
import '../styles/global.css';
import Landing from '../components/Landing';
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>workkit — Composable utilities for Cloudflare Workers</title>
    <meta name="description" content="Type-safe, composable utilities for every Cloudflare Workers binding. Think TanStack for Workers." />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body class="bg-slate-950 text-white">
    <Landing client:load />
  </body>
</html>
```

- [ ] **Step 2: Create PackageGrid component**

Create `apps/docs/src/components/PackageGrid.tsx`:
```tsx
const packages = [
  { name: 'types', desc: 'Shared TypeScript types', icon: '📐' },
  { name: 'errors', desc: 'Structured retry classes', icon: '⚠️' },
  { name: 'env', desc: 'Type-safe env validation', icon: '🔐' },
  { name: 'kv', desc: 'Typed KV with serialization', icon: '📦' },
  { name: 'd1', desc: 'Query builder & migrations', icon: '🗄️' },
  { name: 'r2', desc: 'Streaming & presigned URLs', icon: '☁️' },
  { name: 'cache', desc: 'SWR & tagged invalidation', icon: '⚡' },
  { name: 'queue', desc: 'Typed producer/consumer', icon: '📨' },
  { name: 'do', desc: 'State machines & alarms', icon: '🤖' },
  { name: 'cron', desc: 'Declarative task routing', icon: '⏰' },
  { name: 'ratelimit', desc: 'Fixed, sliding & token bucket', icon: '🚦' },
  { name: 'crypto', desc: 'AES-256-GCM & hashing', icon: '🔑' },
  { name: 'ai', desc: 'Workers AI with streaming', icon: '🧠' },
  { name: 'ai-gateway', desc: 'Multi-provider routing', icon: '🌐' },
  { name: 'api', desc: 'OpenAPI generation', icon: '📋' },
  { name: 'auth', desc: 'JWT & session management', icon: '🛡️' },
  { name: 'testing', desc: 'In-memory binding mocks', icon: '🧪' },
  { name: 'cli', desc: 'Scaffolding & code generation', icon: '⌨️' },
];

export default function PackageGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {packages.map((pkg) => (
        <a
          key={pkg.name}
          href={`/docs/api-reference#workkit${pkg.name}`}
          className="group rounded-lg border border-slate-800 bg-slate-900/50 p-4 hover:border-sky-400/50 hover:bg-slate-900 transition-all"
        >
          <div className="text-2xl mb-2">{pkg.icon}</div>
          <div className="font-mono text-sm text-sky-400">@workkit/{pkg.name}</div>
          <div className="text-xs text-slate-400 mt-1">{pkg.desc}</div>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create CodeExample component**

Create `apps/docs/src/components/CodeExample.tsx`:
```tsx
import { useState } from 'react';

const workkitCode = `import { parseEnvSync } from "@workkit/env"
import { kv } from "@workkit/kv"
import { z } from "zod"

const env = parseEnvSync(rawEnv, {
  API_KEY: z.string().min(1),
  CACHE: z.any(),
})

const cache = kv<User>(env.CACHE, {
  prefix: "user:",
  defaultTtl: 3600,
})

const user = await cache.get("alice")
// ^? User | null — fully typed`;

const rawCode = `export default {
  async fetch(request, env) {
    // No validation — crashes at runtime if missing
    const apiKey = env.API_KEY;

    // No types — everything is unknown
    const raw = await env.CACHE.get("user:alice");
    let user;
    try {
      user = raw ? JSON.parse(raw) : null;
    } catch {
      user = null;
    }

    // No prefix management
    // No TTL defaults
    // No serialization helpers
    // 15+ lines for what workkit does in 3
    return new Response(JSON.stringify(user));
  }
}`;

export default function CodeExample() {
  const [tab, setTab] = useState<'workkit' | 'raw'>('workkit');

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setTab('workkit')}
          className={`px-4 py-2 text-sm font-mono transition-colors ${
            tab === 'workkit'
              ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          with workkit
        </button>
        <button
          onClick={() => setTab('raw')}
          className={`px-4 py-2 text-sm font-mono transition-colors ${
            tab === 'raw'
              ? 'bg-slate-800 text-orange-400 border-b-2 border-orange-400'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          raw cloudflare
        </button>
      </div>
      <pre className="p-4 text-sm overflow-x-auto bg-slate-950">
        <code className={tab === 'workkit' ? 'text-slate-300' : 'text-slate-400'}>
          {tab === 'workkit' ? workkitCode : rawCode}
        </code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Create Landing component**

Create `apps/docs/src/components/Landing.tsx`:
```tsx
import PackageGrid from './PackageGrid';
import CodeExample from './CodeExample';

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="font-bold text-xl font-mono">workkit</div>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <a href="/docs/getting-started" className="hover:text-white transition-colors">Docs</a>
            <a href="/playground" className="hover:text-white transition-colors">Playground</a>
            <a href="/compare" className="hover:text-white transition-colors">Compare</a>
            <a
              href="https://github.com/beeeku/workkit"
              className="hover:text-white transition-colors"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 py-24 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-block px-3 py-1 rounded-full border border-sky-400/30 bg-sky-400/10 text-sky-400 text-xs font-mono mb-6">
            v0.0.1 — 18 packages published
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
            Composable utilities for{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-500">
              Cloudflare Workers
            </span>
          </h1>
          <p className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto">
            Type-safe wrappers for every binding. Use one package or all of them — they're independent, tree-shakeable, and designed to compose.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="/docs/getting-started"
              className="px-6 py-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium transition-colors"
            >
              Get Started
            </a>
            <div className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 font-mono text-sm text-slate-300">
              bunx workkit init
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Less boilerplate. More types.</h2>
          <p className="text-slate-400 text-center mb-8">See the difference.</p>
          <CodeExample />
        </div>
      </section>

      {/* Package Grid */}
      <section className="px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">18 packages. One ecosystem.</h2>
          <p className="text-slate-400 text-center mb-8">Install what you need. Ignore the rest.</p>
          <PackageGrid />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-8 mt-16">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-slate-500">
          <div>MIT License — Built by <a href="https://bika.sh" className="text-slate-400 hover:text-white">Bikash Dash</a></div>
          <div className="font-mono text-xs">built with workkit</div>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Create favicon**

Create `apps/docs/public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#0f172a"/>
  <text x="16" y="22" text-anchor="middle" font-family="monospace" font-size="16" font-weight="bold" fill="#7dd3fc">w</text>
</svg>
```

- [ ] **Step 6: Verify landing page renders**

```bash
cd apps/docs && bun run dev
```

Open http://localhost:4321/ — verify landing page shows hero, code example with toggle, and package grid. Click "Docs" in nav — should go to Starlight docs.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/pages/ apps/docs/src/components/ apps/docs/public/
git commit -m "feat(docs): build landing page with hero, code example, and package grid"
```

---

### Task 6: Build & Deploy Verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Build the docs site**

```bash
cd apps/docs && bun run build
```

Expected: Build succeeds, output in `apps/docs/dist/`. Verify no TypeScript errors, no missing imports.

- [ ] **Step 2: Preview locally**

```bash
cd apps/docs && bun run preview
```

Verify:
- Landing page at `/` renders correctly
- Docs at `/docs/getting-started/` render with sidebar
- All guide pages are accessible
- Navigation between landing and docs works
- Code example toggle works (React island hydration)

- [ ] **Step 3: Verify monorepo integration**

From the root:
```bash
bun run build
```

Verify: All existing packages still build alongside the docs site. No workspace conflicts.

- [ ] **Step 4: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat(docs): verify build and fix any issues"
```

---

### Task 7: Create PR

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin feat/website-phase1
gh pr create --title "feat: add docs site with Starlight, Tailwind, and landing page" --body "$(cat <<'PREOF'
## Summary
- Scaffold Astro + Starlight docs site in apps/docs/
- Configure Tailwind CSS with Starlight theme overrides
- Import all 16 markdown docs with proper frontmatter
- Build custom landing page with hero, code example toggle, and package grid
- Deployed to beeeku.github.io/workkit via GitHub Pages (static)

## What's included
- **Landing page** — Hero with gradient, before/after code toggle, 18-package grid
- **Full docs** — Getting started, architecture, 10 guides, API reference, migration, contributing
- **Starlight sidebar** — Organized into Start Here, Guides, and Reference sections
- **Tailwind + React islands** — shadcn-style components for interactive elements

## Test plan
- [ ] Landing page renders at /
- [ ] Code example toggle works (workkit vs raw cloudflare)
- [ ] All docs pages render at /docs/*
- [ ] Sidebar navigation works
- [ ] Build succeeds with `bun run build`
- [ ] Existing packages unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)"
```
