# @workkit/pdf

Render HTML to PDF in Cloudflare Workers via [`@workkit/browser`](../browser). Includes R2 storage + presign helpers, page/margin presets, and a header/footer composer with HTML escaping by default.

## Install

```bash
bun add @workkit/pdf @workkit/browser @cloudflare/puppeteer
```

## Quick start

```ts
import puppeteer from "@cloudflare/puppeteer";
import { browser } from "@workkit/browser";
import { renderPDF, storedPDF, raw } from "@workkit/pdf";

export default {
  async fetch(req: Request, env: Env) {
    const session = await browser(env.BROWSER, { puppeteer });

    // Pure render
    const bytes = await renderPDF(session, "<h1>Brief</h1>", {
      header: { title: "NIFTY", right: new Date().toISOString() },
      footer: { disclaimer: "Not investment advice", pageNumbers: true },
      disclaimerRequired: true,
    });

    // Render + store + presign
    const { r2Key, url } = await storedPDF(session, "<h1>Brief</h1>", {
      bucket: env.REPORTS,
      key: ["reports", "user-1", `${Date.now()}.pdf`],
      metadata: { userId: "u1", reportId: "r1" },
      presignTtl: 3600,
    });

    return new Response(JSON.stringify({ r2Key, url, size: bytes.byteLength }));
  },
};
```

## API

### `renderPDF(session, html, options?)`

Returns `Promise<Uint8Array>`. Uses `@workkit/browser`'s `withPage` so JS-off, dialog auto-dismiss, abort propagation, and guaranteed page close come for free.

Options:
- `page` — `pageSize.A4 | Letter | Legal`. Default `A4`.
- `margin` — `string | Partial<PageMargin> | PageMargin`. String applies to all sides.
- `header` / `footer` — composed via `composeHeaderFooter()`.
- `disclaimerRequired: true` — fails fast if `footer.disclaimer` is empty.
- `fonts` — `FontDescriptor[]` preloaded via `@workkit/browser`'s `loadFonts()`.
- `signal` — `AbortSignal`.
- `js: true` — opt-in JS execution (off by default).
- `timeoutMs` — per-render timeout.
- `waitUntil` — Puppeteer setContent wait state. Default `networkidle2`.
- `printBackground` — default `true`.
- `scale` — Puppeteer page scale factor.

### `storedPDF(session, html, options)`

Render → R2 upload → presign in one call. Returns `{ r2Key, bytes, url }`.

Additional options on top of `RenderPdfOptions`:
- `bucket` — `R2Bucket`-shaped binding (must implement `put` and, when `readPolicy: "presigned"`, `createPresignedUrl`).
- `key` — `string` or `string[]` (joined via `safeKey()`).
- `metadata` — `Record<string,string>` forwarded to `customMetadata`.
- `readPolicy` — `"presigned"` (default) or `"private"` (skips presign, returns `url: null`).
- `presignTtl` — seconds. Default 3600. **Hard cap 86400 (24h)** — exceeding throws `ValidationError`.
- `contentDisposition` — overrides the `Content-Disposition` header on the stored object.

### Header / footer composition

```ts
import { composeHeaderFooter, raw, escapeHtml } from "@workkit/pdf";

composeHeaderFooter({
  header: {
    logo: raw('<img src="https://cdn.example.com/logo.png" />'),  // raw HTML
    title: "NIFTY",                                                // auto-escaped
    right: new Date().toISOString(),                               // auto-escaped
  },
  footer: {
    disclaimer: "Not investment advice. SEBI Reg No: …",
    pageNumbers: true,
  },
  disclaimerRequired: true,
});
```

**Plain strings auto-escape**. Use `raw()` only for HTML you produced or verified yourself.

### `safeKey(...parts)`

Joins parts with `/` after rejecting `..`, `.`, `\`, control chars, and components that reduce to empty after slash trim. Throws `ValidationError` rather than silently sanitizing.

## Security defaults

- **Header/footer values escape by default** — only `raw()` opt-in passes through unescaped.
- **R2 keys validated** — `safeKey()` rejects path traversal explicitly. No silent transforms.
- **Presigned URL TTL capped at 24h** — bearer-token blast radius. Use `readPolicy: "private"` for longer-lived access.
- **JS off by default** — inherits from `@workkit/browser`.
- **`disclaimerRequired` compliance hook** — fails before render, not after.
- **No HTML body content logged** — caller's logger sees `r2Key`, `bytes`, durations only.

## Cost monitoring

Browser Rendering is priced per session. Recommended pattern:

1. Wire `@workkit/ratelimit` per user before calling `renderPDF` to bound spend.
2. Increment an Analytics Engine counter on every render call.
3. Alert at **50,000 sessions / month** as a sanity ceiling.
4. If you cross that threshold consistently, evaluate `@react-pdf/renderer` (pure JS) for templated content where Browser Rendering's full layout engine isn't needed.

## Versioning

Follows the workkit Constitution — single `src/index.ts` export, no cross-package imports outside declared peer deps. Changesets accompany every public API change.
