import { ValidationError } from "@workkit/errors";
import { type HtmlValue, toSafeHtml } from "./escape";

export interface HeaderFooterParts {
	/** Top-line text or HTML. Plain strings are HTML-escaped. */
	title?: HtmlValue;
	/** Right-aligned text (e.g., timestamp). */
	right?: HtmlValue;
	/** Logo as fully-resolved <img> HTML — wrap with `raw()` in caller. */
	logo?: HtmlValue;
}

export interface HeaderFooterOptions {
	header?: HeaderFooterParts;
	/**
	 * Footer parts. If `disclaimerRequired: true`, `disclaimer` must be
	 * non-empty after coercion or rendering throws `ValidationError`.
	 */
	footer?: HeaderFooterParts & { disclaimer?: HtmlValue; pageNumbers?: boolean };
	/** Compliance hook: refuse to render without a non-empty disclaimer. */
	disclaimerRequired?: boolean;
}

export interface ComposedHeaderFooter {
	displayHeaderFooter: boolean;
	headerTemplate: string;
	footerTemplate: string;
}

const BASE_STYLE =
	"font-size:9px;color:#555;width:100%;padding:0 .5in;display:flex;justify-content:space-between;align-items:center;";

function composeHeader(parts: HeaderFooterParts): string {
	const left = toSafeHtml(parts.logo ?? parts.title ?? "");
	const right = toSafeHtml(parts.right ?? "");
	return `<div style="${BASE_STYLE}"><span>${left}</span><span>${right}</span></div>`;
}

function composeFooter(
	parts: HeaderFooterParts & { disclaimer?: HtmlValue; pageNumbers?: boolean },
): string {
	const disclaimer = toSafeHtml(parts.disclaimer ?? "");
	const pages = parts.pageNumbers
		? '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>'
		: "";
	return `<div style="${BASE_STYLE}"><span>${disclaimer}</span>${pages}</div>`;
}

export function composeHeaderFooter(options: HeaderFooterOptions): ComposedHeaderFooter {
	const hasHeader = options.header !== undefined;
	const hasFooter = options.footer !== undefined;

	if (options.disclaimerRequired === true) {
		const disclaimer = options.footer?.disclaimer;
		const rendered = toSafeHtml(disclaimer ?? "").trim();
		if (rendered.length === 0) {
			throw new ValidationError("disclaimer is required but empty", [
				{
					path: ["footer", "disclaimer"],
					message: "disclaimerRequired:true demands a non-empty footer.disclaimer",
				},
			]);
		}
	}

	return {
		displayHeaderFooter: hasHeader || hasFooter,
		headerTemplate: hasHeader ? composeHeader(options.header ?? {}) : "<div></div>",
		footerTemplate: hasFooter ? composeFooter(options.footer ?? {}) : "<div></div>",
	};
}
