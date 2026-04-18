import { describe, expect, it, vi } from "vitest";
import { withPage } from "../src/page";
import type { BrowserPageLike, BrowserSessionLike } from "../src/types";

interface MockPage extends BrowserPageLike {
	calls: { setJsEnabled?: boolean; closed: number; events: Record<string, Function[]> };
}

function mockSession(opts: { failNewPage?: boolean } = {}): {
	session: BrowserSessionLike;
	page: MockPage;
} {
	const page: MockPage = {
		calls: { closed: 0, events: {} },
		setJavaScriptEnabled(enabled) {
			this.calls.setJsEnabled = enabled;
		},
		setDefaultTimeout() {},
		setDefaultNavigationTimeout() {},
		on(event, handler) {
			(this.calls.events[event] ??= []).push(handler);
			return this;
		},
		async close() {
			this.calls.closed += 1;
		},
	};
	const session: BrowserSessionLike = {
		async newPage() {
			if (opts.failNewPage) throw new Error("nope");
			return page;
		},
		async close() {},
	};
	return { session, page };
}

describe("withPage", () => {
	it("disables JS by default", async () => {
		const { session, page } = mockSession();
		await withPage(session, async () => "ok");
		expect(page.calls.setJsEnabled).toBe(false);
	});

	it("enables JS when js: true", async () => {
		const { session, page } = mockSession();
		await withPage(session, async () => "ok", { js: true });
		expect(page.calls.setJsEnabled).toBe(true);
	});

	it("closes the page after success", async () => {
		const { session, page } = mockSession();
		await withPage(session, async () => "ok");
		expect(page.calls.closed).toBe(1);
	});

	it("closes the page when handler throws and rethrows", async () => {
		const { session, page } = mockSession();
		await expect(
			withPage(session, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(page.calls.closed).toBe(1);
	});

	it("closes the page when an already-aborted signal is passed", async () => {
		const { session, page } = mockSession();
		const ctrl = new AbortController();
		ctrl.abort(new Error("nope"));
		await expect(withPage(session, async () => "ok", { signal: ctrl.signal })).rejects.toThrow(
			"nope",
		);
		expect(page.calls.closed).toBe(1);
	});

	it("closes the page on mid-flight abort", async () => {
		const { session, page } = mockSession();
		const ctrl = new AbortController();
		const promise = withPage(
			session,
			() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
			{ signal: ctrl.signal },
		);
		setTimeout(() => ctrl.abort(new Error("aborted-mid")), 5);
		await expect(promise).rejects.toThrow("aborted-mid");
		expect(page.calls.closed).toBe(1);
	});

	it("attaches a dialog auto-dismiss handler by default", async () => {
		const { session, page } = mockSession();
		await withPage(session, async () => "ok");
		expect(page.calls.events.dialog).toBeDefined();
		expect(page.calls.events.dialog.length).toBe(1);
	});

	it("does NOT attach a dialog handler when autoDismissDialogs: false", async () => {
		const { session, page } = mockSession();
		await withPage(session, async () => "ok", { autoDismissDialogs: false });
		expect(page.calls.events.dialog).toBeUndefined();
	});

	it("normalizes session.newPage failures", async () => {
		const { session } = mockSession({ failNewPage: true });
		await expect(withPage(session, async () => "ok")).rejects.toThrow();
	});

	it("removes the abort listener after the handler settles successfully", async () => {
		const { session } = mockSession();
		const ctrl = new AbortController();
		const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
		const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
		await withPage(session, async () => "ok", { signal: ctrl.signal });
		const adds = addSpy.mock.calls.filter((c) => c[0] === "abort").length;
		const removes = removeSpy.mock.calls.filter((c) => c[0] === "abort").length;
		expect(adds).toBe(1);
		expect(removes).toBeGreaterThanOrEqual(1);
	});

	it("removes the abort listener after the handler rejects", async () => {
		const { session } = mockSession();
		const ctrl = new AbortController();
		const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
		const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
		await expect(
			withPage(
				session,
				async () => {
					throw new Error("boom");
				},
				{ signal: ctrl.signal },
			),
		).rejects.toThrow("boom");
		const adds = addSpy.mock.calls.filter((c) => c[0] === "abort").length;
		const removes = removeSpy.mock.calls.filter((c) => c[0] === "abort").length;
		expect(adds).toBe(1);
		expect(removes).toBeGreaterThanOrEqual(1);
	});
});
