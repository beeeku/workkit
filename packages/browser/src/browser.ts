import { normalizeBrowserError } from "./errors";
import type { BrowserBindingLike, BrowserSessionLike, PuppeteerLike } from "./types";

export interface BrowserSessionOptions {
	/**
	 * Keep the browser session alive between renders, in milliseconds.
	 * Forwarded to `@cloudflare/puppeteer`'s `keep_alive`. Default: omitted
	 * (uses Cloudflare's 60s default; max 600000 / 10 minutes).
	 *
	 * SECURITY: Reusing a session can leak cookies/storage between renders.
	 * Only enable for trusted, non-PII workloads.
	 */
	keepAlive?: number;

	/**
	 * Puppeteer launcher (`@cloudflare/puppeteer`). Required for the scripting
	 * surface — `page.pdf`, `page.screenshot`, `page.evaluate`, `page.click`,
	 * `page.waitForSelector`. Omit only when the raw `binding.launch()` is
	 * enough (open a page, dump final HTML, no scripting). Takes precedence
	 * over `binding.launch()` when both are available.
	 */
	puppeteer?: PuppeteerLike;

	/** Extra options forwarded to `puppeteer.launch(binding, opts)`. */
	launch?: Record<string, unknown>;
}

/**
 * Acquire a Cloudflare Browser Rendering session.
 *
 * Uses `options.puppeteer.launch(binding, opts)` when supplied. Otherwise,
 * uses `binding.launch(opts)` when the binding exposes it directly.
 */
export async function browser(
	binding: BrowserBindingLike,
	options: BrowserSessionOptions = {},
): Promise<BrowserSessionLike> {
	const launchOpts = {
		...(typeof options.keepAlive === "number" ? { keep_alive: options.keepAlive } : {}),
		...options.launch,
	};

	try {
		if (options.puppeteer) {
			return await options.puppeteer.launch(binding, launchOpts);
		}
		if (typeof binding.launch === "function") {
			return await binding.launch(launchOpts);
		}
		throw new Error(
			"no launcher available — supply `options.puppeteer` (e.g., @cloudflare/puppeteer) or use a binding with .launch()",
		);
	} catch (err) {
		throw normalizeBrowserError("browser.launch", err);
	}
}
