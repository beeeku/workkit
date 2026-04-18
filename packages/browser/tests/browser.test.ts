import { ServiceUnavailableError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { browser } from "../src/browser";
import type { BrowserBindingLike, BrowserSessionLike, PuppeteerLike } from "../src/types";

function fakeSession(): BrowserSessionLike {
	return {
		async newPage() {
			return { setJavaScriptEnabled() {}, async close() {} };
		},
		async close() {},
	};
}

describe("browser()", () => {
	it("uses binding.launch when present and forwards launch options", async () => {
		const seen: Record<string, unknown>[] = [];
		const binding: BrowserBindingLike = {
			async launch(opts) {
				seen.push(opts ?? {});
				return fakeSession();
			},
		};
		await browser(binding, { keepAlive: 30_000, launch: { foo: 1 } });
		expect(seen[0]).toEqual({ keep_alive: 30_000, foo: 1 });
	});

	it("uses options.puppeteer.launch when supplied", async () => {
		const calls: unknown[] = [];
		const puppeteer: PuppeteerLike = {
			async launch(binding, opts) {
				calls.push({ binding, opts });
				return fakeSession();
			},
		};
		const binding: BrowserBindingLike = {};
		await browser(binding, { puppeteer });
		expect(calls).toHaveLength(1);
		expect((calls[0] as { binding: unknown }).binding).toBe(binding);
	});

	it("throws when no launcher is available", async () => {
		await expect(browser({} as BrowserBindingLike)).rejects.toBeInstanceOf(ServiceUnavailableError);
	});

	it("normalizes launch failures through @workkit/errors", async () => {
		const binding: BrowserBindingLike = {
			async launch() {
				throw { status: 503, message: "down" };
			},
		};
		await expect(browser(binding)).rejects.toBeInstanceOf(ServiceUnavailableError);
	});
});
