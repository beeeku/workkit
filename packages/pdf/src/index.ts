// Render
export { renderPDF } from "./render";
export type { RenderPdfOptions } from "./render";

// Store
export { storedPDF } from "./store";
export type { StorePdfOptions, StorePdfResult, ReadPolicy } from "./store";

// Header / footer composition
export { composeHeaderFooter } from "./header";
export type { HeaderFooterOptions, HeaderFooterParts, ComposedHeaderFooter } from "./header";

// Escape helpers
export { escapeHtml, raw, isRaw, toSafeHtml } from "./escape";
export type { Raw, HtmlValue } from "./escape";

// R2 key safety
export { safeKey } from "./safe-key";

// Presets
export { pageSize, margin, defaults, resolveMargin } from "./presets";
export type { PageSize, PageMargin } from "./presets";

// Public types
export type { R2BucketLike, PdfCapablePage, PdfPageOptions } from "./types";
