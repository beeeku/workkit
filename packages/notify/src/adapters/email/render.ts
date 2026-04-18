/**
 * Render an email body to HTML + plain text.
 *
 * - String template ⇒ treated as ready HTML.
 * - React element ⇒ lazy-import `@react-email/render` (optional peer); throws
 *   if absent. Caller composes the React element themselves so we don't add
 *   a React peer dep here.
 *
 * Note: an earlier API surface accepted a `props` field; it was unused at
 * render time and removed (callers should pass a fully composed React
 * element).
 */

interface RenderArgs {
	template: unknown;
	text?: string;
}

interface Rendered {
	html: string;
	text: string;
}

interface ReactEmailRenderModule {
	render: (
		element: unknown,
		options?: { plainText?: boolean; pretty?: boolean },
	) => Promise<string> | string;
}

let cachedRenderer: ReactEmailRenderModule | null | undefined;

async function loadReactEmail(): Promise<ReactEmailRenderModule> {
	if (cachedRenderer) return cachedRenderer;
	if (cachedRenderer === null) {
		throw new Error(
			"@react-email/render is required when using a React Email template; install it as a peer dep",
		);
	}
	try {
		// Optional peer — declared in peerDependencies, not bundled.
		// @ts-expect-error: optional peer dep, may not be installed
		const mod = (await import("@react-email/render")) as unknown as ReactEmailRenderModule;
		cachedRenderer = mod;
		return mod;
	} catch {
		cachedRenderer = null;
		throw new Error(
			"@react-email/render is required when using a React Email template; install it as a peer dep",
		);
	}
}

export async function renderEmail(args: RenderArgs): Promise<Rendered> {
	let html: string;
	if (typeof args.template === "string") {
		html = args.template;
	} else {
		const re = await loadReactEmail();
		const rendered = await re.render(args.template, { pretty: false });
		html = typeof rendered === "string" ? rendered : await Promise.resolve(rendered);
	}
	const text = args.text ?? htmlToText(html);
	return { html, text: text.length > 0 ? text : "[no text content]" };
}

/**
 * Strip script/style blocks, then tags, decode the most common HTML entities,
 * collapse whitespace. Good enough for an automatic plain-text fallback.
 * Pass `text` explicitly when fidelity matters.
 */
export function htmlToText(html: string): string {
	let s = html;
	s = s.replace(/<(script|style)[\s\S]*?<\/(?:script|style)>/gi, "");
	s = s.replace(/<br\s*\/?>(\s*)/gi, "\n");
	s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
	s = s.replace(/<[^>]+>/g, "");
	s = s
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");
	s = s.replace(/[ \t]+/g, " ");
	s = s.replace(/\n{3,}/g, "\n\n");
	return s.trim();
}

/** Test-only — clear the cached renderer state. */
export function __resetRenderer(): void {
	cachedRenderer = undefined;
}
