# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: Thin functional wrapper. No classes, no internal state. Each export takes the binding (or a session/page) plus options and returns a Promise.
- **Integration points**:
  - `env.BROWSER` Cloudflare Browser Rendering binding (consumer-supplied).
  - `@workkit/errors` for normalized error types.
  - Standard Schema accepted for any user-supplied option validation (none required in v1; planning for future expansion).
  - Downstream: `@workkit/pdf` (issue #24) consumes `browser()` + `withPage()`.

## Key Technical Decisions

- **Functional API over class API** — matches existing workkit packages (`@workkit/health`, `@workkit/turnstile`); no instance state to track.
- **`@cloudflare/puppeteer` types** — Cloudflare Browser Rendering's binding exposes a Puppeteer-compatible interface. Use `@cloudflare/puppeteer` peer types so callers don't pay the runtime cost (it's bundled by the runtime).
- **Lifecycle helper instead of explicit close** — `withPage(session, fn)` ensures `page.close()` runs in `finally` regardless of throw or signal abort. Mirrors Node's `using` semantics without requiring TS 5.2+.
- **Abort signal first-class** — option object accepts `signal: AbortSignal`. On abort: page closes, in-flight nav rejects with `AbortError` mapped to `@workkit/errors`.
- **`javaScriptEnabled: false` default** — set via `page.setJavaScriptEnabled(false)` immediately after page acquisition.
- **No URL-navigation helper in v1** — callers use `setContent(html)` for trusted templated rendering. Document explicitly that URL navigation requires their own SSRF guard. Avoids shipping a guard we'd own forever for a use case `@workkit/pdf` doesn't need.
- **Borrowed from `vercel-labs/agent-browser`**: `allowedDomains: string[]` option on `withPage` (when set, page navigation requests outside the list are blocked at the network layer); env-override `WORKKIT_BROWSER_TIMEOUT_MS` for default timeouts; auto-dismiss `alert`/`confirm`/`beforeunload` dialogs by default with `noAutoDialog: true` opt-out.
- **Font loading via `@font-face` injection** — inject a `<style>` block with `src: url(...)` before `setContent`, then `await page.evaluate(() => document.fonts.ready)` with timeout. Document the timeout-vs-fail tradeoff.
- **Visual regression** — defer baseline shape to `maina verify --visual` (Playwright MCP). Provide example HTML inputs under `tests/visual-fixtures/`.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/browser/package.json` | Package manifest (deps: `@workkit/errors`; peer: `@cloudflare/puppeteer`) | New |
| `packages/browser/tsconfig.json` | Extends `tooling/tsconfig/library.json` | New |
| `packages/browser/bunup.config.ts` | Build config | New |
| `packages/browser/vitest.config.ts` | Test config | New |
| `packages/browser/src/index.ts` | Single export entry — re-exports public API | New |
| `packages/browser/src/browser.ts` | `browser()` — session acquire + `keepAlive` | New |
| `packages/browser/src/page.ts` | `withPage()` — lifecycle helper, JS-disabled default, abort-aware | New |
| `packages/browser/src/fonts.ts` | `loadFonts()` — `@font-face` inject + `document.fonts.ready` await with timeout | New |
| `packages/browser/src/errors.ts` | Map Browser Rendering errors → `@workkit/errors` types | New |
| `packages/browser/tests/page.test.ts` | Page lifecycle, abort, throw, JS-disabled invariants | New |
| `packages/browser/tests/fonts.test.ts` | Font load success + timeout behavior | New |
| `packages/browser/tests/errors.test.ts` | Error mapping (rate limit, timeout, validation) | New |
| `packages/browser/tests/visual-fixtures/basic.html` | Plain text render baseline | New |
| `packages/browser/tests/visual-fixtures/font.html` | Custom font render baseline | New |
| `packages/browser/tests/visual-fixtures/image.html` | Image embed baseline | New |
| `packages/browser/README.md` | Public docs incl. security notes (JS off default, no URL helper) + visual-regression usage | New |
| `.changeset/workkit-browser-init.md` | `@workkit/browser@0.1.0` initial publish | New |
| `pnpm-workspace.yaml` / `package.json` workspace | Add `packages/browser` if not auto-globbed | Verify |

## Tasks

TDD: every implementation task has a preceding test task.

1. Scaffold package skeleton (package.json, tsconfig, bunup, vitest, README stub) — no source.
2. Test: error mapping (`errors.test.ts`) — write red.
3. Implement `errors.ts` — make green.
4. Test: `withPage` close-on-throw and close-on-abort (`page.test.ts`) — write red, mock binding.
5. Implement `page.ts` — make green.
6. Test: `loadFonts` success + timeout behavior (`fonts.test.ts`) — write red.
7. Implement `fonts.ts` — make green.
8. Test: `browser()` session acquisition with keepAlive — write red.
9. Implement `browser.ts` — make green.
10. Wire `src/index.ts` exports.
11. Add visual fixtures under `tests/visual-fixtures/`.
12. Run `maina verify` → fix findings.
13. Run `maina verify --visual` → establish baselines.
14. Run `maina review` → fix findings.
15. Add changeset.
16. `maina commit` with conventional commit.
17. Push branch + open PR against master.
18. Request `copilot-pull-request-reviewer` review.
19. Address Copilot feedback in follow-up commits, re-verify.

## Failure Modes

- **Page leak on user-throw** — `withPage` finally block missing → ALWAYS use `try/finally`, asserted by test that runs handler that throws then inspects close call count.
- **Page leak on abort mid-navigation** — abort fires while `page.goto`/`setContent` is in-flight → register abort listener, await close before propagating.
- **Font silently falls back** — font URL 404 → `document.fonts.ready` resolves anyway because the @font-face was registered. Mitigation: after `fonts.ready`, check `document.fonts.check("1em <family>")`; throw if false.
- **Network-idle never fires** — long-poll/SSE pages never reach `networkidle0`. Default to `networkidle2` + 15s hard timeout, configurable.
- **Browser session 429** — Cloudflare per-account session caps. Map provider 429 → `@workkit/errors` `RateLimitError` with `retryAfter` if header present.
- **`keepAlive` cross-render leak** — cookies/storage from previous render persist. Document loudly; no automatic cleanup (caller asked for keepAlive, they own the consequence).

## Testing Strategy

- **Unit tests (mocked binding)** — most behavior covered with a hand-rolled mock that records page lifecycle calls. Covers: lifecycle invariants, error mapping, font timeout, abort propagation.
- **Integration tests (live binding)** — gated by env var `RUN_BROWSER_INTEGRATION=1`. Run against actual Browser Rendering in CI. Covers: round-trip render of a fixture HTML.
- **Visual regression** — `maina verify --visual` against fixtures in `tests/visual-fixtures/`. Baselines committed; updates require `--update` and a reviewer comment explaining the diff.
- **Mocks needed** — `BrowserBinding` interface mock with call recorder; `AbortController`/`AbortSignal` from std lib (no mock).


## Wiki Context

### Related Modules

- **src** (69 entities) — `modules/src.md`
- **cluster-64** (7 entities) — `modules/cluster-64.md`

### Suggestions

- New module `packages/browser` — wiki recompile after merge will pick it up; no need to extend existing modules.
