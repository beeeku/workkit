# Implementation Plan — @workkit/pdf

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- **Pattern**: Functional, two public entry points (`renderPDF`, `storedPDF`). Internal `escape`/`raw`/`safeKey`/`composeHeaderFooter` helpers.
- **Layering**: pdf depends on `@workkit/browser` for session+page, on `@workkit/errors` for error types. Optional dep on `@workkit/r2`-shape (consumer passes `R2Bucket` directly — we don't wrap their bucket type).
- **Integration points**:
  - `@workkit/browser`: `browser()`, `withPage()`, `loadFonts()`.
  - R2: native `R2Bucket.put()` + `createPresignedUrl()` (or fallback `aws4fetch`-style sign for older bindings).

## Key Technical Decisions

- **Reuse `withPage` from browser package** — inherits abort/JS-off/dialog defaults for free; we don't reinvent lifecycle.
- **Compose header/footer via Puppeteer's native `displayHeaderFooter` + `headerTemplate` + `footerTemplate`** — gives us page numbers `<span class="pageNumber">` and total `<span class="totalPages">` for free. Inject our own escaped HTML into those templates.
- **`escape(text)` returns a branded `Escaped` string; `raw(html)` returns a branded `Raw` string** — composition functions accept `Escaped | Raw`. Plain strings get auto-escaped. Forces explicit decision at the call site.
- **`safeKey(...parts)` joins parts with `/` after stripping `..`, `\`, control chars, and rejecting absolute paths** — throws `ValidationError` on disallowed input rather than silently transforming.
- **Presign via R2 native `createPresignedUrl()` if available, else error with explicit guidance** — don't ship our own sigv4 implementation in v1; consumers on older R2 SDKs can use a pre-signed-url helper.
- **No streaming upload in v1** — measure first; add when a real consumer hits the cap.
- **Cost monitoring guidance only** — no auto-counter; recommend Analytics Engine pattern in README. Adding a counter would require a new binding.

## Files

| File | Purpose | New/Modified |
|---|---|---|
| `packages/pdf/package.json` | Manifest (deps: `@workkit/browser`, `@workkit/errors`) | New |
| `packages/pdf/tsconfig.json` | Extends library tsconfig | New |
| `packages/pdf/bunup.config.ts` | Build config | New |
| `packages/pdf/vitest.config.ts` | Test config | New |
| `packages/pdf/src/index.ts` | Public exports | New |
| `packages/pdf/src/render.ts` | `renderPDF()` | New |
| `packages/pdf/src/store.ts` | `storedPDF()` | New |
| `packages/pdf/src/presets.ts` | A4/Letter/Legal + margin presets | New |
| `packages/pdf/src/header.ts` | Header/footer templates + composition | New |
| `packages/pdf/src/escape.ts` | `escape()`/`raw()` branded strings + HTML escape | New |
| `packages/pdf/src/safe-key.ts` | `safeKey()` R2 path sanitizer | New |
| `packages/pdf/src/types.ts` | Public option types + R2 binding shape | New |
| `packages/pdf/tests/escape.test.ts` | Escaping correctness + brand checks | New |
| `packages/pdf/tests/safe-key.test.ts` | Path traversal + control char rejection | New |
| `packages/pdf/tests/header.test.ts` | Header/footer composition; raw vs escape | New |
| `packages/pdf/tests/render.test.ts` | render with mocked withPage; header injection; disclaimerRequired | New |
| `packages/pdf/tests/store.test.ts` | round-trip with mocked R2 + browser; presign TTL clamp; metadata | New |
| `packages/pdf/tests/presets.test.ts` | preset objects sanity | New |
| `packages/pdf/README.md` | Public docs incl. cost guidance | New |
| `.changeset/feat-pdf-init.md` | `@workkit/pdf@0.1.0` initial publish | New |

## Tasks (TDD red→green order)

1. scaffold (package.json, tsconfig, bunup, vitest, README stub)
2. test:escape → impl:escape
3. test:safeKey → impl:safeKey
4. test:presets → impl:presets
5. test:header → impl:header
6. test:render → impl:render (mocks `@workkit/browser` `withPage`)
7. test:store → impl:store (mocks R2 + browser)
8. wire src/index.ts
9. lint + typecheck + scoped tests
10. maina verify
11. changeset
12. maina commit
13. push + PR (base: feature/001-workkit-browser; will rebase to master after #32 merges)
14. request review

## Failure Modes

- **HTML injection in header/footer** — call site forgets to wrap user input → escape-by-default for plain strings; `raw()` is the visible escape hatch.
- **R2 path traversal via untrusted key parts** — `safeKey()` rejects; render fails with `ValidationError` rather than silently writing outside intended namespace.
- **Presigned URL TTL exceeds policy** — clamp to max 86400s; warn-or-throw on out-of-range (throw, since silent clamp is worse).
- **R2 PUT fails mid-render** — render bytes are wasted; surface `ServiceUnavailableError`. Don't retry — caller knows their queue/retry policy.
- **`disclaimerRequired: true` with empty disclaimer** — fail fast at compose time, not after render. Compliance-friendly.
- **Browser Rendering 429 / cost spike** — bubble through `@workkit/browser`'s `RateLimitError`; document recommended `@workkit/ratelimit` pre-gate.
- **Large HTML / large PDF** — document size caps in README; don't pre-validate (puppeteer will reject).

## Testing Strategy

- **Unit (mocks)** — escape, safeKey, header composition, presets are pure-function tests.
- **Integration (mocked withPage + R2)** — render and store, with hand-rolled mocks for `withPage(session, fn)` that invoke `fn` with a mock page exposing `setContent`/`pdf`/`addStyleTag`/`evaluate`.
- **e2e (gated by env var)** — `RUN_BROWSER_INTEGRATION=1 bun test` runs renderPDF against a live binding via wrangler dev. Not in regular CI.
- **Visual regression** — same `tests/visual-fixtures/` pattern; add a brief HTML and verify PDF render baseline via `maina verify --visual` once available.

## Stacking

- Branch: `feature/003-workkit-pdf`
- Base: `feature/001-workkit-browser` (pdf needs browser source locally for workspace resolution)
- Strategy: PR opened against `master` once #32 merges; before that, draft PR against `feature/001-workkit-browser` is acceptable for visibility.


## Wiki Context

Auto-populated by maina; no edits needed.
