---
title: "PDF Rendering"
---

# PDF Rendering

`@workkit/pdf` renders HTML to PDF in Cloudflare Workers via [`@workkit/browser`](/workkit/guides/browser-rendering/). It owns the PDF-specific concerns (page presets, header/footer composition, R2 storage + presign) and delegates browser lifecycle to its base.

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

    // Render + R2 + presign in one call
    const { r2Key, url } = await storedPDF(session, "<h1>Brief</h1>", {
      bucket: env.REPORTS,
      key: ["reports", "user-1", `${Date.now()}.pdf`],
      metadata: { userId: "u1", reportId: "r1" },
      presignTtl: 3600,
    });

    return new Response(JSON.stringify({ r2Key, url, bytes: bytes.byteLength }));
  },
};
```

## API

### `renderPDF(session, html, options?)`

Returns `Promise<Uint8Array>`. Inherits JS-off, dialog auto-dismiss, abort propagation, and guaranteed page close from `@workkit/browser`'s `withPage`.

Key options:
- `page` — `pageSize.A4 | Letter | Legal`. Default `A4`.
- `margin` — `string | Partial<PageMargin> | PageMargin`. String applies to all sides.
- `header` / `footer` — composed via `composeHeaderFooter()`.
- `disclaimerRequired: true` — fails fast if `footer.disclaimer` is empty.
- `fonts` — `FontDescriptor[]` preloaded via `@workkit/browser`'s `loadFonts`.
- `signal`, `js`, `timeoutMs`, `waitUntil`, `printBackground`, `scale`.

### `storedPDF(session, html, options)`

Render → R2 upload → presign in one call. Returns `{ r2Key, bytes, url }`.

Additional options:
- `bucket` — `R2Bucket`-shaped binding.
- `key` — `string` or `string[]` (joined via `safeKey()`).
- `metadata` — `Record<string,string>` forwarded to `customMetadata`.
- `readPolicy` — `"presigned"` (default) or `"private"` (returns `url: null`).
- `presignTtl` — seconds. Default 3600. **Hard cap 86400 (24h)** — exceeding throws `ValidationError`.
- `contentDisposition` — overrides the stored object's header.

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

**Plain strings auto-escape**. Use `raw()` only for HTML you produced yourself.

### `safeKey(...parts)`

Joins parts with `/` after rejecting `..`, `.`, `\`, control chars, and components that reduce to empty after slash trim. Throws `ValidationError` rather than silently sanitizing.

## Security defaults

- **Header/footer values escape by default** — only `raw()` opt-in passes through unescaped.
- **R2 keys validated** — `safeKey()` rejects path traversal explicitly.
- **Presigned URL TTL capped at 24h** — bearer-token blast radius.
- **JS off by default** — inherited from `@workkit/browser`.
- **`disclaimerRequired` compliance hook** — fails before render, not after.
- **No HTML body content logged.**

## Cost monitoring

Browser Rendering is priced per session. See [Browser Rendering — Cost monitoring](/workkit/guides/browser-rendering/#cost-monitoring) for the recommended pattern (per-user rate limit + Analytics Engine counter + 50k/mo alert).

## See also

- [Browser Rendering](/workkit/guides/browser-rendering/) — the underlying primitive.
- [Notifications](/workkit/guides/notifications/) — `@workkit/notify`'s email adapter accepts PDFs as attachments.
