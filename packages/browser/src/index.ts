// Session
export { browser } from "./browser";
export type { BrowserSessionOptions } from "./browser";

// Page lifecycle
export { withPage } from "./page";
export type { WithPageOptions } from "./page";

// Fonts
export { loadFonts } from "./fonts";
export type { FontDescriptor, LoadFontsOptions } from "./fonts";

// Errors
export { FontLoadError, normalizeBrowserError } from "./errors";

// Types
export type {
	BrowserBindingLike,
	BrowserPageLike,
	BrowserSessionLike,
	PuppeteerLike,
} from "./types";
