# Feature: @workkit/pdf — PDF rendering on top of @workkit/browser

Tracks GitHub issue #24. Built on top of #23 (`@workkit/browser`). Stacked on `feature/001-workkit-browser`.

## Problem Statement

Generating PDFs in Cloudflare Workers is the canonical content-production use case for Browser Rendering, and it's the immediate driver behind building `@workkit/browser`. Without `@workkit/pdf`, every consumer (entryexit briefs first, future products next) re-implements the same `setContent → loadFonts → page.pdf → R2 upload → presign` pipeline and reinvents header/footer composition.

If we don't solve this, PDF code drifts package-to-package, the security defaults (HTML escaping in headers, presign TTL caps, cost monitoring) get re-decided each time, and the boundary with `@workkit/notify` (PDFs as attachments) becomes blurry.

## Target User

- **Primary**: workkit consumers who need to produce PDF documents (briefs, reports, invoices, statements) inside a Worker, store them in R2, and hand them to `@workkit/notify` as attachments.
- **Secondary**: future workkit packages that compose pdf with other primitives (e.g., a templating layer or a billing-receipts helper).

## User Stories

- As an entryexit engineer, I want to render a "Pre-Market Brief" HTML to a PDF and stash it in R2 with a presigned link in one call.
- As a product engineer, I want to attach a header/logo/timestamp and a regulatory disclaimer footer without writing my own composition.
- As a security-conscious developer, I want header/footer values from user input HTML-escaped by default so a curated brief can't get hijacked.
- As a finance/ops engineer, I want a deliberate `disclaimerRequired` mode that fails the render if no disclaimer is present (compliance hook).

## Success Criteria

- [ ] `renderPDF(html, opts)` returns the PDF byte buffer; works against a real Browser Rendering binding via `@workkit/browser`.
- [ ] `storedPDF(html, opts)` round-trips through R2 with tagged metadata and returns `{ r2Key, url }` (presigned).
- [ ] Header/footer values from caller props are HTML-escaped by default; `raw()` opt-in available.
- [ ] R2 key path-traversal guard (`safeKey()` helper or inline sanitization) blocks `..`, control chars, and absolute paths.
- [ ] Presigned URL TTL capped (default 3600s, max 24h).
- [ ] No HTML body content logged.
- [ ] Browser Rendering errors normalized via `@workkit/browser` (which already maps to `@workkit/errors`).
- [ ] `@workkit/testing` integration present.
- [ ] Single `src/index.ts` export.
- [ ] Changeset added.
- [ ] LOC budget ≤250 (target 100-200).
- [ ] README documents cost monitoring guidance and 50k-sessions/month alert.

## Scope

### In Scope

- `renderPDF(html, opts)` — pure render returning `Uint8Array`.
- `storedPDF(html, opts)` — render + R2 upload + presign in one call.
- Page presets: A4 (default for India market), Letter, Legal.
- Margin presets: `narrow`, `normal`, `wide`, custom inches/mm.
- Header/footer composition helpers (logo, timestamp, page number, disclaimer).
- `escape()` and `raw()` template helpers for header/footer.
- `safeKey()` helper for R2 path sanitization.
- R2 metadata tagging hook for `@workkit/cache` invalidation pattern.
- Cost-awareness guidance in README.

### Out of Scope

- Browser session management (delegated to `@workkit/browser`).
- Font loading (delegated to `@workkit/browser`).
- Tailwind CDN integration helpers (caller owns CSS strategy; we don't ship tailwind).
- React Email or other component-based template helpers (separate concern).
- Multi-page document composition / TOC (caller authors HTML).
- PDF/A or PDF/X compliance (defer until requested).
- `@react-pdf/renderer` fallback (alternative implementation; defer until cost forces it).

## Design Decisions

- **Built on `@workkit/browser`** — `withPage` lifecycle is reused so PDF rendering inherits abort safety, JS-off default, and dialog auto-dismiss for free.
- **Header/footer escape by default** — header/footer content frequently includes user-derived data (timestamps, account numbers). The `raw()` opt-in mirrors React's `dangerouslySetInnerHTML` pattern so explicit risk is visible at the call site.
- **Presigned URL TTL ceiling** — 3600s default, hard cap at 86400s (24h). Rationale: presigned URLs are bearer tokens, anyone with the link can read. Document the limit; recommend signed cookies / auth proxy for highly sensitive content.
- **`safeKey()` over silent sanitization** — explicit helper makes the path-traversal risk visible in callsites instead of papering over it. We refuse to silently transform input keys.
- **A4 as default page size** — primary market is India (entryexit). Letter remains a preset for US-targeted callers.
- **No tailwind/CSS framework integration** — opinionated about HTML in / PDF out, neutral about how the HTML is built. Avoids tying us to a CSS toolchain that may not match consumer choices.
- **R2 upload via single-shot PUT in v1** — most briefs <2MB; multipart upload deferred until a real consumer needs it.

## Open Questions

- Should `storedPDF` accept a `readPolicy: "presigned" | "public" | "private"` so the presign step can be skipped (e.g., signed-cookie consumers)? — Lean yes; simple. Confirm during implementation.
- Should we support specifying header/footer as a separate HTML string (uses Puppeteer's `displayHeaderFooter` + `headerTemplate`/`footerTemplate`) or always inject inline? — Lean towards inline for v1 simplicity; document inline pattern. Re-evaluate if a consumer needs page-numbered footers.
