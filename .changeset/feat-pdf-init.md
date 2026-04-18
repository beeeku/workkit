---
"@workkit/pdf": minor
---

Add `@workkit/pdf` — render HTML to PDF in Cloudflare Workers via
`@workkit/browser`, with R2 storage and presign helpers.

- `renderPDF(session, html, opts)` returns the PDF byte array. Uses
  `@workkit/browser`'s `withPage` so JS-off, dialog auto-dismiss, abort
  propagation, and guaranteed page close come for free.
- `storedPDF(session, html, opts)` renders, uploads to R2, and presigns in
  one call. Returns `{ r2Key, bytes, url }`.
- `composeHeaderFooter()` produces Puppeteer-compatible header/footer
  templates. Plain string values are HTML-escaped by default; `raw()` is
  the only opt-in for unescaped HTML.
- `safeKey(...parts)` rejects path traversal (`..`, `.`, leading `/`,
  backslashes, control chars) and throws `ValidationError` rather than
  silently sanitizing.
- Page-size + margin presets (A4 default for the Indian market; Letter,
  Legal, narrow/normal/wide margins).
- `disclaimerRequired: true` fails fast before render if `footer.disclaimer`
  is empty (compliance hook).
- Presigned URL TTL defaults to 3600s and is hard-capped at 86400s (24h).
  Use `readPolicy: "private"` for longer-lived access through an
  authenticated proxy.

Closes #24.
