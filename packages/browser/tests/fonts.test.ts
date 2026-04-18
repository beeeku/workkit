import { TimeoutError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { FontLoadError } from "../src/errors";
import { loadFonts } from "../src/fonts";
import type { BrowserPageLike } from "../src/types";

interface MockPage extends BrowserPageLike {
	addStyleTag(opts: { content: string }): Promise<unknown>;
	evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
	captured: { css: string[]; readyDelayMs: number; checkResult: boolean };
}

function mockPage(opts: { readyDelayMs?: number; checkResult?: boolean } = {}): MockPage {
	return {
		captured: {
			css: [],
			readyDelayMs: opts.readyDelayMs ?? 0,
			checkResult: opts.checkResult ?? true,
		},
		setJavaScriptEnabled() {},
		async close() {},
		async addStyleTag(opt) {
			this.captured.css.push(opt.content);
		},
		async evaluate<T>(fn: string | ((...args: unknown[]) => T)): Promise<T> {
			const src = typeof fn === "string" ? fn : fn.toString();
			if (src.includes("fonts.ready")) {
				await new Promise((r) => setTimeout(r, this.captured.readyDelayMs));
				return undefined as T;
			}
			return (this.captured.checkResult ? [] : ["Inter"]) as T;
		},
	};
}

describe("loadFonts", () => {
	it("no-ops when given an empty list", async () => {
		const page = mockPage();
		await loadFonts(page, []);
		expect(page.captured.css).toHaveLength(0);
	});

	it("rejects non-https font URLs", async () => {
		const page = mockPage();
		await expect(
			loadFonts(page, [{ family: "Inter", url: "http://example.com/inter.woff2" }]),
		).rejects.toThrow(FontLoadError);
	});

	it("injects @font-face CSS when fonts are valid", async () => {
		const page = mockPage();
		await loadFonts(page, [
			{ family: "Inter", url: "https://fonts.example.com/Inter.woff2", weight: 400 },
		]);
		expect(page.captured.css[0]).toContain("@font-face");
		expect(page.captured.css[0]).toContain("Inter");
		expect(page.captured.css[0]).toContain("font-weight: 400");
	});

	it("times out when document.fonts.ready never resolves in time", async () => {
		const page = mockPage({ readyDelayMs: 200 });
		await expect(
			loadFonts(page, [{ family: "Inter", url: "https://fonts.example.com/Inter.woff2" }], {
				timeoutMs: 30,
			}),
		).rejects.toThrow(TimeoutError);
	});

	it("throws FontLoadError when document.fonts.check returns false after load", async () => {
		const page = mockPage({ checkResult: false });
		await expect(
			loadFonts(page, [{ family: "Inter", url: "https://fonts.example.com/Inter.woff2" }]),
		).rejects.toThrow(FontLoadError);
	});

	it("skips availability check when verifyAvailable: false", async () => {
		const page = mockPage({ checkResult: false });
		await expect(
			loadFonts(page, [{ family: "Inter", url: "https://fonts.example.com/Inter.woff2" }], {
				verifyAvailable: false,
			}),
		).resolves.toBeUndefined();
	});
});
