---
"@workkit/browser": minor
---

Add `@workkit/browser` — Cloudflare Browser Rendering primitive providing
session/page lifecycle helpers, font loading, and normalized errors. Built as
the shared base for `@workkit/pdf` and future screenshot/OG packages.

- `browser(env.BROWSER, opts)` — acquire a session via `binding.launch()` or a
  caller-supplied `@cloudflare/puppeteer` instance.
- `withPage(session, fn, opts)` — guarantees `page.close()` on success, throw,
  or abort. JavaScript execution is off by default.
- `loadFonts(page, fonts, opts)` — injects `@font-face` declarations and
  verifies fonts are actually available (no silent fallback). HTTPS-only.
- Errors normalized through `@workkit/errors` (`RateLimitError` with
  `Retry-After` parsing, `TimeoutError`, `ServiceUnavailableError`,
  `FontLoadError`).
- Default operation timeout 15s, env-overridable via
  `WORKKIT_BROWSER_TIMEOUT_MS`.
- Auto-dismisses `alert`/`confirm`/`prompt`/`beforeunload` dialogs.

Closes #23.
