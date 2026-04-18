/**
 * Internal types — abstracts the surface we use from `@cloudflare/puppeteer`
 * so we don't take a hard dependency for typing alone.
 */

export interface BrowserPageLike {
	setJavaScriptEnabled(enabled: boolean): Promise<void> | void;
	setDefaultTimeout?(ms: number): void;
	setDefaultNavigationTimeout?(ms: number): void;
	setRequestInterception?(enabled: boolean): Promise<void>;
	on?(event: string, handler: (...args: unknown[]) => unknown): unknown;
	close(): Promise<void>;
}

export interface BrowserSessionLike {
	newPage(): Promise<BrowserPageLike>;
	close(): Promise<void>;
}

export interface BrowserBindingLike {
	launch?(options?: Record<string, unknown>): Promise<BrowserSessionLike>;
	fetch?(...args: unknown[]): Promise<Response>;
}

/**
 * Puppeteer-compatible interface — `puppeteer.launch(env.BROWSER)` from
 * `@cloudflare/puppeteer`. Optional peer; supplied at runtime by the consumer.
 */
export interface PuppeteerLike {
	launch(binding: unknown, options?: Record<string, unknown>): Promise<BrowserSessionLike>;
}
