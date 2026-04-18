# Feature: @workkit/browser — Cloudflare Browser Rendering primitive

Tracks GitHub issue #23.

## Problem Statement

`@workkit/pdf` (issue #24) needs to use Cloudflare Browser Rendering, and so will future utilities for screenshots, OG image generation, and DOM scraping. If each of those packages re-implements browser session/page lifecycle, font loading, and error normalization, we end up with duplicated, drift-prone code and pdf becomes the wrong place to extract the primitive from.

If we don't solve this now, `@workkit/pdf` accumulates browser-specific internals that will need a painful extract-refactor later, and the next consumer (screenshot/OG) reinvents the same plumbing.

## Target User

- **Primary**: workkit package authors building any feature on top of Cloudflare Browser Rendering (`@workkit/pdf` first, future `@workkit/og`/screenshot utilities next).
- **Secondary**: end-user developers using those packages — they benefit indirectly from a single, well-tested browser primitive instead of N divergent ones.

## User Stories

- As a workkit package author, I want a thin `withPage()` lifecycle helper so I can never leak a browser page on throw or abort.
- As a workkit package author, I want font preloading helpers so my consumers don't silently render the wrong font.
- As a workkit package author, I want Browser Rendering errors normalized through `@workkit/errors` so consumers get consistent error types.
- As a security-conscious developer, I want JS execution disabled by default and explicit guards against SSRF so I can render untrusted HTML safely.

## Success Criteria

- [ ] `withPage()` proven leak-free under thrown handler error AND under aborted signal (test-covered).
- [ ] Network-idle timeout default 15s, configurable, documented.
- [ ] `javaScriptEnabled: false` is the default.
- [ ] If any URL navigation helper exists, SSRF guard blocks RFC1918, link-local, and cloud metadata endpoints by default.
- [ ] Errors normalized through `@workkit/errors` (`RateLimitError`, `TimeoutError`, `ValidationError`, etc.).
- [ ] Visual regression baselines established via `maina verify --visual` for representative HTML inputs (basic text, custom font, image embed).
- [ ] `@workkit/testing` integration present.
- [ ] Single `src/index.ts` export.
- [ ] Changeset added.
- [ ] LOC budget held: ≤200 (target 80-150).

## Scope

### In Scope

- `browser(env.BROWSER, opts)` — acquire browser session with optional `keepAlive`.
- `withPage(session, fn)` — page lifecycle with guaranteed cleanup.
- `loadFonts(page, [{family, url}])` — font preloading.
- Error normalization → `@workkit/errors`.
- `safeNavigate(page, url, opts)` — optional URL navigation helper with SSRF guard (only if needed; otherwise document that callers use `setContent` for full control).
- Visual regression baselines for primitive behavior.

### Out of Scope

- PDF generation (`@workkit/pdf`, issue #24).
- Screenshot helpers (future `@workkit/og` or similar).
- Headless scraping helpers (different use case, different security profile).
- Browser pool / concurrency manager (defer until a real consumer needs it).
- Browser Rendering REST API wrapper (binding-only).

## Design Decisions

- **Build before `@workkit/pdf`** — extracting later means breaking pdf's internal imports and a forced version coordination. Building first keeps pdf as a thin consumer from day one. (See roadmap epic #22.)
- **`javaScriptEnabled: false` default** — almost all PDF/OG use cases render trusted templated HTML; JS execution is an attack surface. Opt-in for the rare case (`{ js: true }`).
- **`keepAlive` opt-in only** — sharing a browser session between renders introduces cross-render state leak. Default to fresh session; document the leak risk if `keepAlive` enabled.
- **No URL allowlist by default** — if a URL navigation helper ships, it blocks private + metadata IP ranges by default. Allowlist is opt-in via `{ allowPrivate: true }`. Refusing to ship the helper at all was considered but rejected because consumers will write a worse one inline.
- **Visual regression via `maina verify --visual`** — already wired with Playwright MCP. Reusing the harness instead of inventing a new pixelmatch setup.

## Open Questions

- Does Cloudflare Browser Rendering binding API support all the lifecycle hooks `withPage` needs (close on signal abort)? — Will verify during implementation against the actual binding.
- Should `loadFonts` block until the font is loaded, or fire-and-forget? — Lean toward block-with-timeout; never silent fallback. Confirm during spec phase.
