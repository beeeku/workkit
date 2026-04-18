import { normalizeBrowserError } from "./errors";
import type { BrowserPageLike, BrowserSessionLike } from "./types";

const DEFAULT_TIMEOUT_MS = readEnvTimeout(15_000);

function readEnvTimeout(fallback: number): number {
	const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.WORKKIT_BROWSER_TIMEOUT_MS;
	const parsed = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface WithPageOptions {
	/**
	 * Allow JavaScript execution. Default: false.
	 *
	 * SECURITY: untrusted HTML can execute scripts when js=true. Only enable
	 * for trusted templated content.
	 */
	js?: boolean;

	/**
	 * Per-page operation timeout (ms). Default: 15000 (overridable via the
	 * `WORKKIT_BROWSER_TIMEOUT_MS` env var).
	 */
	timeoutMs?: number;

	/**
	 * Cancellation signal. On abort the page is closed and the promise rejects
	 * with the abort reason.
	 */
	signal?: AbortSignal;

	/**
	 * Auto-dismiss `alert`, `confirm`, `prompt`, and `beforeunload` dialogs.
	 * Default: true.
	 */
	autoDismissDialogs?: boolean;
}

/**
 * Run `fn` against a freshly acquired page and guarantee `page.close()` runs
 * regardless of throw, return, or signal abort.
 *
 * - JS execution disabled by default.
 * - Default operation timeout 15s.
 * - Dialogs auto-dismissed by default.
 */
export async function withPage<T>(
	session: BrowserSessionLike,
	fn: (page: BrowserPageLike) => Promise<T>,
	options: WithPageOptions = {},
): Promise<T> {
	let page: BrowserPageLike;
	try {
		page = await session.newPage();
	} catch (err) {
		throw normalizeBrowserError("session.newPage", err);
	}

	let closed = false;
	const closePage = async () => {
		if (closed) return;
		closed = true;
		try {
			await page.close();
		} catch {
			// swallow — close after error is best-effort
		}
	};

	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	page.setDefaultTimeout?.(timeout);
	page.setDefaultNavigationTimeout?.(timeout);

	try {
		await page.setJavaScriptEnabled(options.js === true);

		if (options.autoDismissDialogs !== false && typeof page.on === "function") {
			page.on("dialog", async (dialog: unknown) => {
				const d = dialog as { dismiss?: () => Promise<void> };
				try {
					await d.dismiss?.();
				} catch {
					// best-effort
				}
			});
		}

		const signal = options.signal;
		if (signal?.aborted) throw signalReason(signal);

		if (signal) {
			return await new Promise<T>((resolve, reject) => {
				const onAbort = () => {
					signal.removeEventListener("abort", onAbort);
					reject(signalReason(signal));
				};
				signal.addEventListener("abort", onAbort, { once: true });

				fn(page)
					.then((value) => {
						signal.removeEventListener("abort", onAbort);
						resolve(value);
					})
					.catch((err) => {
						signal.removeEventListener("abort", onAbort);
						reject(err);
					});
			});
		}

		return await fn(page);
	} finally {
		await closePage();
	}
}

function signalReason(signal: AbortSignal): Error {
	const reason = (signal as AbortSignal & { reason?: unknown }).reason;
	if (reason instanceof Error) return reason;
	const err = new Error(typeof reason === "string" ? reason : "aborted");
	err.name = "AbortError";
	return err;
}
