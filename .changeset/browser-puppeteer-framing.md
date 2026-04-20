---
"@workkit/browser": patch
---

**Docs: reframe `@cloudflare/puppeteer` as scripting-API dependency, not a launcher requirement.** The previous framing implied the binding had no `.launch()` method without `@cloudflare/puppeteer`, which is outdated — workerd exposes `binding.launch()` natively. The honest framing is: bring `@cloudflare/puppeteer` if you want Puppeteer's scripting API (`page.pdf`, `page.screenshot`, `page.evaluate`, etc.), skip it only if a bare session that can open a page and dump HTML is enough.

`browser()` already supports both paths; this is purely a docs and JSDoc clarification on `BrowserSessionOptions.puppeteer`. README, the `browser-rendering` docs guide, and the `puppeteer` option JSDoc all updated.

Closes #75.
