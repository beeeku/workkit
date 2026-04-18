import type { BrowserPageLike, BrowserSessionLike, FontDescriptor } from "@workkit/browser";

/**
 * The subset of `R2Bucket` we use. Letting consumers pass any binding-shape
 * that implements these methods keeps tests trivial and avoids a hard
 * dependency on `@cloudflare/workers-types` at the type level.
 */
export interface R2BucketLike {
	put(
		key: string,
		body: ArrayBuffer | ArrayBufferView | ReadableStream | string,
		options?: {
			httpMetadata?: { contentType?: string; contentDisposition?: string };
			customMetadata?: Record<string, string>;
		},
	): Promise<unknown>;
	createPresignedUrl?: (
		key: string,
		options: { expiresIn: number; method?: "GET" | "PUT" },
	) => Promise<string>;
}

/** A page that supports `setContent` + `pdf` (Puppeteer-compatible). */
export interface PdfCapablePage extends BrowserPageLike {
	setContent(
		html: string,
		options?: { waitUntil?: string | string[]; timeout?: number },
	): Promise<void>;
	pdf(options?: PdfPageOptions): Promise<Uint8Array>;
}

export interface PdfPageOptions {
	format?: string;
	margin?: { top?: string; bottom?: string; left?: string; right?: string };
	printBackground?: boolean;
	displayHeaderFooter?: boolean;
	headerTemplate?: string;
	footerTemplate?: string;
	preferCSSPageSize?: boolean;
	scale?: number;
}

export type { BrowserSessionLike, FontDescriptor };
