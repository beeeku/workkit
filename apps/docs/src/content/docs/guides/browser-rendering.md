---
title: "Browser Rendering"
---

# Browser Rendering

`@workkit/browser` is a thin primitive over Cloudflare Browser Rendering — session/page lifecycle, font loading, and normalized errors. It's the shared base for `@workkit/pdf` and any future screenshot/OG packages.

## Install

```bash
bun add @workkit/browser @cloudflare/puppeteer
```

`@cloudflare/puppeteer` is an optional peer — bring your own version.

**When you need it:** anything that touches Puppeteer's scripting API — `page.pdf`, `page.screenshot`, `page.evaluate`, `page.click`, `waitForSelector`. That's the quick-start below and most real workloads.

**When you can skip it:** the raw `BROWSER` binding now exposes `.launch()` natively, returning a minimal session that can open a page and dump final HTML but cannot script it. `browser()` automatically takes this path when `options.puppeteer` is not supplied. Useful only if you're bundle-size-constrained and don't need the scripting surface.

## Quick start

```ts
import puppeteer from "@cloudflare/puppeteer";
import { browser, withPage, loadFonts } from "@workkit/browser";

export default {
  async fetch(req: Request, env: Env) {
    const session = await browser(env.BROWSER, { puppeteer });

    const bytes = await withPage(session, async (page) => {
      await (page as any).setContent("<h1>Hello</h1>", { waitUntil: "networkidle2" });
      await loadFonts(page, [
        { family: "Inter", url: "https://fonts.example.com/Inter.woff2" },
      ]);
      return (page as any).pdf({ format: "A4" });
    });

    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  },
};
```

## API

### `browser(binding, options?)`

Acquires a Cloudflare Browser Rendering session.

- `binding` — `env.BROWSER`
- `options.puppeteer` — `@cloudflare/puppeteer` instance (recommended)
- `options.keepAlive` — `number` (ms) — keep session alive between renders. Off by default; opt-in carries a state-leak risk.
- `options.launch` — extra options forwarded to `puppeteer.launch`

### `withPage(session, fn, options?)`

Runs `fn(page)` with guaranteed `page.close()` on success, throw, or abort.

- `options.js` — `boolean` (default `false`). Untrusted HTML can execute scripts when `true`.
- `options.timeoutMs` — per-page operation timeout. Default `15000`. Override globally via `WORKKIT_BROWSER_TIMEOUT_MS`.
- `options.signal` — `AbortSignal`. On abort the page closes and the promise rejects with the abort reason.
- `options.autoDismissDialogs` — auto-dismiss `alert`/`confirm`/`prompt`/`beforeunload`. Default `true`.

### `loadFonts(page, fonts, options?)`

Injects `@font-face` declarations and waits for them to be ready.

- `fonts` — `Array<{ family, url, weight?, style?, display? }>`. URLs must be HTTPS.
- `options.timeoutMs` — default `5000`.
- `options.verifyAvailable` — default `true` (no silent fallback). Throws `FontLoadError` if the registered font isn't actually available after load.

## Security defaults

- **JS off by default.** Untrusted HTML cannot execute scripts unless you opt in with `js: true`.
- **No URL navigation helper.** Use `page.setContent(html)` for trusted templated rendering. If you need to navigate to URLs, write your own SSRF guard at the call site — we don't ship one because the right policy is consumer-specific.
- **`keepAlive` leaks state.** Cookies, storage, and JS state persist when sharing a session. Only use for trusted, non-PII workloads.
- **Font URLs are HTTPS-only.** `loadFonts` rejects `http://`, `data:`, `file://` and characters that could break out of the `url("…")` token (quotes, parens, control chars, backslash). Same guard for family names.
- **Dialogs auto-dismissed by default.** Prevents stuck pages on `beforeunload`/`confirm` from untrusted templates.

## Errors

All failures normalize through `@workkit/errors`:

| Condition | Error |
|---|---|
| Browser binding 429 (with `Retry-After`) | `RateLimitError` (carries `retryAfterMs`; case-insensitive header lookup) |
| Browser binding 502/503/504 | `ServiceUnavailableError` |
| Operation timeout | `TimeoutError` |
| Font registered but unavailable | `FontLoadError` (extends `ValidationError`) |
| Non-HTTPS or unsafe font URL | `FontLoadError` |

## Cost monitoring

Browser Rendering is priced per session. Recommended pattern:

1. Wire `@workkit/ratelimit` per user before calling any render function.
2. Increment an Analytics Engine counter on every session acquisition.
3. Alert at **50,000 sessions / month** as a sanity ceiling.
4. If you cross the threshold consistently, evaluate `@react-pdf/renderer` for templated content where Browser Rendering's full layout engine isn't needed.

## See also

- [PDF Rendering](/workkit/guides/pdf-rendering/) — `@workkit/pdf` builds on `@workkit/browser`.
- [Cloudflare Browser Rendering docs](https://developers.cloudflare.com/browser-rendering/)
