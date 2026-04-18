/**
 * Header/footer template values are HTML-escaped by default. To inject HTML
 * intentionally, wrap with `raw()` — that's the only escape hatch.
 *
 * Branding via runtime object wrappers (not phantom types) so we can actually
 * tell at runtime whether a caller marked something as safe.
 */

const RAW_BRAND: unique symbol = Symbol("@workkit/pdf/raw");

export interface Raw {
	readonly [RAW_BRAND]: true;
	readonly html: string;
}

export type HtmlValue = string | number | boolean | Raw | null | undefined;

const ESC_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: string | number | boolean | null | undefined): string {
	if (value === null || value === undefined) return "";
	const str = typeof value === "string" ? value : String(value);
	return str.replace(/[&<>"']/g, (ch) => ESC_MAP[ch] ?? ch);
}

/**
 * Mark a string as already-safe HTML. Use only with strings you produced
 * yourself or verified to be safe — anything user-influenced should stay a
 * plain string and let the composer escape it.
 */
export function raw(html: string): Raw {
	return { [RAW_BRAND]: true, html };
}

export function isRaw(value: unknown): value is Raw {
	return typeof value === "object" && value !== null && (value as Raw)[RAW_BRAND] === true;
}

/**
 * Coerce a value to safe HTML. Plain strings/numbers/booleans get HTML-
 * escaped. Only `raw(...)`-wrapped values pass through unescaped.
 */
export function toSafeHtml(value: HtmlValue): string {
	if (value === null || value === undefined) return "";
	if (isRaw(value)) return value.html;
	return escapeHtml(value);
}
