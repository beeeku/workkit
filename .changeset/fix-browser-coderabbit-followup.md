---
"@workkit/browser": patch
---

Address CodeRabbit review feedback from #32:

- **`browser.ts`** — narrow `keepAlive` option from `number | boolean` to
  `number` (milliseconds). Cloudflare's `keep_alive` is strictly numeric;
  passing `true`/`false` was silently ignored.
- **`browser.ts`** — fix doc comment that incorrectly described a binding-first
  / dynamic-import strategy. `puppeteer.launch(binding, opts)` is used when
  `options.puppeteer` is supplied; `binding.launch(opts)` otherwise.
- **`errors.ts`** — `readHeader` now case-insensitive for `Record<string,string>`
  headers (was exact-keyed, so `{"retry-after":"2"}` lost the value).
- **`errors.ts`** — `parseRetryAfterMs` requires a strict numeric pattern before
  treating the value as delta-seconds, falling through to `Date.parse` for
  HTTP-date forms. Prevents misreading tokens like `"2025"` as 2025 seconds.
- **`fonts.ts`** — `validateFonts` now rejects font URLs that fail `new URL()`,
  use a non-`https:` scheme, or contain characters that could break out of the
  `url("…")` token (`"`, `'`, `(`, `)`, `\`, control chars). Same guard applied
  to font family names since they are emitted into the `12px "<family>"`
  argument of `document.fonts.check`.
- **Tests** — added cases for lowercase `Retry-After` records, non-numeric
  Retry-After tokens, HTTP-date Retry-After parsing, malformed font URLs,
  CSS-injection attempts in font URL/family, and abort-listener cleanup after
  successful and rejected handler settlement.
- **Visual fixtures** — `basic.html` now uses an explicit `Helvetica, Arial,
  sans-serif` stack instead of `system-ui` for deterministic baselines across
  CI vs developer machines. `font.html` ships with an inline `@font-face`
  declaration so the fixture actually exercises the Inter font path instead
  of silently falling back to system fonts.

No public API changes beyond narrowing `keepAlive` (which previously did
nothing for boolean values, so no observable behavior loss).
