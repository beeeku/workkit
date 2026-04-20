# @workkit/browser

Cloudflare Browser Rendering primitive — session/page lifecycle, font loading, normalized errors. The shared base for `@workkit/pdf` and future screenshot/OG packages.

## Install

```bash
bun add @workkit/browser @cloudflare/puppeteer
```

`@cloudflare/puppeteer` is an optional peer dependency — bring your own version.

Required if you want Puppeteer's scripting API: `page.pdf`, `page.screenshot`, `page.evaluate`, `page.click`, `waitForSelector`, etc. — i.e. anything in the quick-start below. The 95% case wants this.

The raw `BROWSER` binding also exposes `.launch()` natively (workerd >= recent versions), which gives a minimal session: open a page and dump final HTML, no scripting surface. Useful only when you're bundle-size-constrained and can live without Puppeteer's API. `browser()` falls back to this path automatically when `options.puppeteer` is not supplied.

## Quick start

```ts
import puppeteer from "@cloudflare/puppeteer";
import { browser, withPage, loadFonts } from "@workkit/browser";

export default {
  async fetch(req: Request, env: Env) {
    const session = await browser(env.BROWSER, { puppeteer });

    const bytes = await withPage(session, async (page) => {
      await (page as any).setContent("<h1>Hello</h1>", { waitUntil: "networkidle2" });
      await loadFonts(page, [{ family: "Inter", url: "https://fonts.example.com/Inter.woff2" }]);
      return (page as any).pdf({ format: "A4" });
    });

    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  },
};
```

## API

### `browser(binding, options?)`

Acquire a Cloudflare Browser Rendering session.

- `binding` — `env.BROWSER`
- `options.puppeteer` — `@cloudflare/puppeteer` instance (recommended)
- `options.keepAlive` — `number | boolean` — keep session alive between renders. **Default off.** See security note below.
- `options.launch` — extra options forwarded to `puppeteer.launch`.

### `withPage(session, fn, options?)`

Run `fn(page)` against a freshly acquired page and guarantee `page.close()` runs even on throw, return, or abort.

- `options.js` — `boolean` (default `false`). Untrusted HTML can execute scripts when `true`.
- `options.timeoutMs` — per-page operation timeout. Default `15000`. Override globally via `WORKKIT_BROWSER_TIMEOUT_MS`.
- `options.signal` — `AbortSignal`. On abort the page closes and the promise rejects with the abort reason.
- `options.autoDismissDialogs` — auto-dismiss `alert`/`confirm`/`prompt`/`beforeunload`. Default `true`.

### `loadFonts(page, fonts, options?)`

Inject `@font-face` declarations and wait for them to be ready. Throws `TimeoutError` on timeout, `FontLoadError` if a font registers but is not actually available.

- `fonts` — `Array<{ family, url, weight?, style?, display? }>`. URLs **must** be HTTPS.
- `options.timeoutMs` — default `5000`.
- `options.verifyAvailable` — default `true` (no silent fallback). Set `false` to skip the `document.fonts.check` post-load verification.

## Security notes

- **JS off by default.** Untrusted HTML cannot execute scripts unless you opt in with `js: true`.
- **No URL navigation helper.** Use `page.setContent(html)` for trusted templated rendering. If you need to navigate to URLs, write your own SSRF guard at the call site — we do not ship one because the right policy is consumer-specific.
- **`keepAlive` leaks state.** Cookies, storage, and JS state from previous renders persist when sharing a session. Only use for trusted, non-PII workloads.
- **Font URLs are HTTPS-only.** `loadFonts` rejects `http://`, `data:`, `file://`.
- **Dialogs auto-dismissed by default.** Prevents stuck pages on `beforeunload`/`confirm` from untrusted templates.

## Errors

All failures normalize through `@workkit/errors`:

| Condition | Error |
|---|---|
| Browser binding 429 (with `Retry-After`) | `RateLimitError` (carries `retryAfterMs`) |
| Browser binding 502/503/504 | `ServiceUnavailableError` |
| Operation timeout | `TimeoutError` |
| Font registered but unavailable | `FontLoadError` (extends `ValidationError`) |
| Non-HTTPS font URL | `FontLoadError` |

## Visual regression

Run `maina verify --visual` to baseline the fixtures under `tests/visual-fixtures/`. Baselines live under `tests/__visual__/` (created on first run). Updates require an explicit reviewer note explaining the diff.

## Versioning

`@workkit/browser` follows the workkit Constitution — single `src/index.ts` export, Standard Schema where validation is needed, no cross-package imports outside declared peer deps. Changesets accompany every public API change.
