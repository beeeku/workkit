/**
 * Page size + margin presets. Dimensions in inches; Puppeteer accepts unit
 * suffixes in `format`/`margin` strings, but for clarity we expose
 * structured shapes and convert at call time.
 */

export interface PageSize {
	/** Page format string (Puppeteer-recognized: A4, Letter, Legal, etc.). */
	format: "A4" | "Letter" | "Legal";
	/** Width in inches (informational; Puppeteer derives from format). */
	width: number;
	/** Height in inches (informational; Puppeteer derives from format). */
	height: number;
}

export interface PageMargin {
	top: string;
	bottom: string;
	left: string;
	right: string;
}

export const pageSize = {
	A4: { format: "A4", width: 8.27, height: 11.69 } as PageSize,
	Letter: { format: "Letter", width: 8.5, height: 11 } as PageSize,
	Legal: { format: "Legal", width: 8.5, height: 14 } as PageSize,
} as const;

export const margin = {
	narrow: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } as PageMargin,
	normal: { top: "1in", bottom: "1in", left: "1in", right: "1in" } as PageMargin,
	wide: { top: "1.5in", bottom: "1.5in", left: "1.5in", right: "1.5in" } as PageMargin,
} as const;

/** Default for the Indian market (entryexit's primary audience). */
export const defaults = {
	page: pageSize.A4,
	margin: margin.normal,
} as const;

/**
 * Coerce a user-supplied margin shape into a `PageMargin`. Accepts a single
 * string (applies to all sides), a partial object (missing sides default to
 * `1in`), or a full margin record.
 */
export function resolveMargin(
	value: string | Partial<PageMargin> | PageMargin | undefined,
): PageMargin {
	if (value === undefined) return defaults.margin;
	if (typeof value === "string") {
		return { top: value, bottom: value, left: value, right: value };
	}
	return {
		top: value.top ?? "1in",
		bottom: value.bottom ?? "1in",
		left: value.left ?? "1in",
		right: value.right ?? "1in",
	};
}
