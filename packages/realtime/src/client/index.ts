import type { SubscribeOptions } from "../types";
import { createSseParser } from "./parse";

const DEFAULT_BACKOFF = { initialMs: 500, maxMs: 10_000 };
const DEFAULT_POLLING_AFTER_MS = 45_000;
const POLL_INTERVAL_MS = 15_000;

interface Subscription {
	unsubscribe(): void;
}

interface PollEvent {
	event: string;
	id: number;
	data: unknown;
}

function buildUrl(baseUrl: string, lastEventId: number): string {
	const hasQuery = baseUrl.includes("?");
	const sep = hasQuery ? "&" : "?";
	return `${baseUrl}${sep}lastEventId=${lastEventId}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function subscribe(url: string, opts: SubscribeOptions): Subscription {
	const backoff = opts.backoff ?? DEFAULT_BACKOFF;
	const pollingAfterMs = opts.pollingAfterMs ?? DEFAULT_POLLING_AFTER_MS;

	let closed = false;
	let lastEventId = 0;
	let failures = 0;
	let firstFailureAt = 0;
	let currentController: AbortController | undefined;

	// Track the external-signal listener so unsubscribe can detach it — a
	// page-level AbortController outlives any single subscription.
	const externalSignal = opts.signal;
	const onExternalAbort = () => unsubscribe();

	const unsubscribe = () => {
		if (closed) return;
		closed = true;
		externalSignal?.removeEventListener("abort", onExternalAbort);
		currentController?.abort();
	};

	if (externalSignal) {
		if (externalSignal.aborted) {
			closed = true;
		} else {
			externalSignal.addEventListener("abort", onExternalAbort, { once: true });
		}
	}

	const onFrame = ({ event, id, data }: { event: string; id?: number; data: string }) => {
		if (id !== undefined) lastEventId = id;
		let parsed: unknown = data;
		try {
			parsed = JSON.parse(data);
		} catch {
			// leave as string
		}
		opts.onEvent(event, parsed, lastEventId);
	};

	// Idle timeout (stalled-proxy guard): tear the stream down if no bytes arrive for 2.5x the server heartbeat.
	const idleTimeoutMs = (opts.heartbeatMs ?? 30_000) * 2.5;

	const consumeStream = async (
		body: ReadableStream<Uint8Array>,
		onFirstByte: () => void,
		controller: AbortController,
	): Promise<void> => {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		const feed = createSseParser(onFrame);
		let gotByte = false;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const armIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				controller.abort();
				// reader.cancel() forces the pending read() to resolve done.
				reader.cancel().catch(() => undefined);
			}, idleTimeoutMs);
		};
		armIdle();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) return;
				if (!gotByte) {
					gotByte = true;
					onFirstByte();
				}
				feed(decoder.decode(value, { stream: true }));
				armIdle();
			}
		} finally {
			if (idleTimer) clearTimeout(idleTimer);
			try {
				reader.releaseLock();
			} catch {
				// reader.cancel() already released
			}
		}
	};

	const pollLoop = async (pollUrl: string): Promise<void> => {
		while (!closed) {
			const ctrl = new AbortController();
			currentController = ctrl;
			try {
				const res = await fetch(buildUrl(pollUrl, lastEventId), { signal: ctrl.signal });
				if (res.ok) {
					const events = (await res.json()) as PollEvent[];
					for (const e of events) {
						lastEventId = e.id;
						opts.onEvent(e.event, e.data, e.id);
					}
				}
			} catch {
				if (closed) return;
			}
			if (closed) return;
			await sleep(POLL_INTERVAL_MS, ctrl.signal);
		}
	};

	const run = async (): Promise<void> => {
		while (!closed) {
			const ctrl = new AbortController();
			currentController = ctrl;
			try {
				const headers: Record<string, string> = { accept: "text/event-stream" };
				// Send via both the header (native SSE convention) and the query param
				// (our fallback), matching the broker's dual-read contract.
				if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
				const res = await fetch(buildUrl(url, lastEventId), {
					signal: ctrl.signal,
					headers,
				});
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
				// Only reset the failure window once the stream actually delivers
				// bytes — a 200 that immediately closes shouldn't clear the clock
				// that feeds the polling threshold.
				await consumeStream(res.body, () => {
					failures = 0;
					firstFailureAt = 0;
				}, ctrl);
			} catch (err) {
				if (closed || (err as Error).name === "AbortError") return;
			}
			if (closed) return;
			failures += 1;
			if (firstFailureAt === 0) firstFailureAt = Date.now();
			if (opts.fallbackPollingUrl && Date.now() - firstFailureAt >= pollingAfterMs) {
				await pollLoop(opts.fallbackPollingUrl);
				return;
			}
			opts.onReconnect?.(failures);
			if (closed) return;
			const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** (failures - 1));
			await sleep(delay, currentController.signal);
		}
	};

	if (!closed) void run();

	return { unsubscribe };
}
