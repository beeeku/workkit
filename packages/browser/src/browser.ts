import { normalizeBrowserError } from "./errors";
import type { BrowserBindingLike, BrowserSessionLike, PuppeteerLike } from "./types";

export interface BrowserSessionOptions {
	/**
	 * Keep the browser session alive between renders. Default: false.
	 *
	 * SECURITY: Reusing a session can leak cookies/storage between renders.
	 * Only enable for trusted, non-PII workloads.
	 */
	keepAlive?: number | boolean;

	/**
	 * Puppeteer launcher (`@cloudflare/puppeteer`). Optional — supply if you
	 * want explicit control, otherwise the helper attempts a dynamic import.
	 */
	puppeteer?: PuppeteerLike;

	/** Extra options forwarded to `puppeteer.launch(binding, opts)`. */
	launch?: Record<string, unknown>;
}

/**
 * Acquire a Cloudflare Browser Rendering session.
 *
 * Prefers `binding.launch(opts)` when the binding exposes it directly. Falls
 * back to a `puppeteer.launch(binding, opts)` call when an explicit puppeteer
 * shim is provided via `options.puppeteer`.
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
