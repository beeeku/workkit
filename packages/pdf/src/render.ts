import { loadFonts, withPage } from "@workkit/browser";
import { type HeaderFooterOptions, composeHeaderFooter } from "./header";
import { type PageMargin, type PageSize, defaults, resolveMargin } from "./presets";
import type { BrowserSessionLike, FontDescriptor, PdfCapablePage, PdfPageOptions } from "./types";

export interface RenderPdfOptions extends HeaderFooterOptions {
	/** Page size preset or shape. Default: A4. */
	page?: PageSize;
	/** Margin preset, full record, partial, or single string. Default: 1in all sides. */
	margin?: string | Partial<PageMargin> | PageMargin;
	/** Print backgrounds (default true — most reports want them). */
	printBackground?: boolean;
	/** Optional font preloads applied via `@workkit/browser`'s `loadFonts`. */
	fonts?: FontDescriptor[];
	/** Forwarded to `withPage`'s abort signal. */
	signal?: AbortSignal;
	/** Allow JS execution in the rendered HTML. Default false. */
	js?: boolean;
	/** Per-render operation timeout (ms). Default 15000 (or env override). */
	timeoutMs?: number;
	/** Override Puppeteer's `setContent` waitUntil. Default `networkidle2`. */
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	/** Page scale factor (Puppeteer). */
	scale?: number;
}

/**
 * Render an HTML string to a PDF byte array using the supplied browser session.
 *
 * Uses `@workkit/browser`'s `withPage` so JS-off, dialog auto-dismiss, abort
 * propagation, and guaranteed page close come for free.
 */
export async function renderPDF(
	session: BrowserSessionLike,
	html: string,
	options: RenderPdfOptions = {},
): Promise<Uint8Array> {
	const composed = composeHeaderFooter(options);
	const margin = resolveMargin(options.margin);
	const page = options.page ?? defaults.page;
	const waitUntil = options.waitUntil ?? "networkidle2";

	const pdfOptions: PdfPageOptions = {
		format: page.format,
		margin,
		printBackground: options.printBackground !== false,
		displayHeaderFooter: composed.displayHeaderFooter,
		headerTemplate: composed.headerTemplate,
		footerTemplate: composed.footerTemplate,
	};
	if (options.scale !== undefined) pdfOptions.scale = options.scale;

	return await withPage(
		session,
		async (rawPage) => {
			const pdfPage = rawPage as PdfCapablePage;
			await pdfPage.setContent(html, { waitUntil });
			if (options.fonts && options.fonts.length > 0) {
				await loadFonts(pdfPage, options.fonts);
			}
			return await pdfPage.pdf(pdfOptions);
		},
		{
			signal: options.signal,
			js: options.js,
			timeoutMs: options.timeoutMs,
		},
	);
}
