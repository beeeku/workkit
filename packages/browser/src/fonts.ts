import { TimeoutError } from "@workkit/errors";
import { FontLoadError, normalizeBrowserError } from "./errors";
import type { BrowserPageLike } from "./types";

export interface FontDescriptor {
	family: string;
	url: string;
	weight?: number | string;
	style?: "normal" | "italic" | "oblique";
	display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

export interface LoadFontsOptions {
	/** Per-font load timeout (ms). Default: 5000. */
	timeoutMs?: number;
	/**
	 * Throw if a font is registered but `document.fonts.check()` returns false
	 * after load. Default: true (no silent fallback).
	 */
	verifyAvailable?: boolean;
}

interface PageWithEvaluation extends BrowserPageLike {
	evaluate?: <T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]) => Promise<T>;
	addStyleTag?: (opts: { content: string }) => Promise<unknown>;
}

function buildFontFaceCss(fonts: FontDescriptor[]): string {
	return fonts
		.map((f) => {
			const parts = [
				`font-family: ${JSON.stringify(f.family)}`,
				`src: url(${JSON.stringify(f.url)})`,
			];
			if (f.weight !== undefined) parts.push(`font-weight: ${f.weight}`);
			if (f.style) parts.push(`font-style: ${f.style}`);
			if (f.display) parts.push(`font-display: ${f.display}`);
			return `@font-face { ${parts.join("; ")}; }`;
		})
		.join("\n");
}

function validateFonts(fonts: FontDescriptor[]): void {
	for (const f of fonts) {
		if (!/^https:\/\//i.test(f.url)) {
			throw new FontLoadError(f.family, new Error(`font url must use https://: ${f.url}`));
		}
	}
}

/**
 * Inject `@font-face` declarations into the current page and wait for them
 * to be ready. Throws `TimeoutError` on timeout, `FontLoadError` if a font
 * registers but is not actually available after load.
 *
 * `setContent`/`goto` should run BEFORE calling `loadFonts` so a document
 * exists to attach the style tag to.
 */
export async function loadFonts(
	page: BrowserPageLike,
	fonts: FontDescriptor[],
	options: LoadFontsOptions = {},
): Promise<void> {
	if (fonts.length === 0) return;
	validateFonts(fonts);

	const p = page as PageWithEvaluation;
	if (!p.addStyleTag || !p.evaluate) {
		throw new Error(
			"page.addStyleTag / page.evaluate not available — pass a Puppeteer-compatible page",
		);
	}

	const timeoutMs = options.timeoutMs ?? 5000;
	const css = buildFontFaceCss(fonts);

	try {
		await p.addStyleTag({ content: css });
	} catch (err) {
		throw normalizeBrowserError("loadFonts.addStyleTag", err);
	}

	const readyFn = "() => document.fonts.ready";
	try {
		await Promise.race([
			p.evaluate(readyFn),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new TimeoutError("loadFonts", timeoutMs)), timeoutMs),
			),
		]);
	} catch (err) {
		if (err instanceof TimeoutError) throw err;
		throw normalizeBrowserError("loadFonts.ready", err);
	}

	if (options.verifyAvailable !== false) {
		const checkFn =
			"(families) => families.filter((f) => !document.fonts.check('12px \"' + f + '\"'))";
		const missing = (await p.evaluate(
			checkFn,
			fonts.map((f) => f.family),
		)) as string[];
		if (missing.length > 0) {
			throw new FontLoadError(missing[0] ?? "unknown");
		}
	}
}
