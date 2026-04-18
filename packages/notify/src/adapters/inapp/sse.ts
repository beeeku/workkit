import type { NotifyD1 } from "../../types";

export interface SseSubscriber {
	userId: string;
	close(): void;
	push(payload: string): void;
}

/**
 * In-memory SSE registry. Single Worker isolate scope — multi-isolate
 * fan-out belongs to a future Durable-Object-backed adapter.
 */
export class SseRegistry {
	private map = new Map<string, Set<SseSubscriber>>();

	add(sub: SseSubscriber): void {
		let set = this.map.get(sub.userId);
		if (!set) {
			set = new Set();
			this.map.set(sub.userId, set);
		}
		set.add(sub);
	}

	remove(sub: SseSubscriber): void {
		const set = this.map.get(sub.userId);
		if (!set) return;
		set.delete(sub);
		if (set.size === 0) this.map.delete(sub.userId);
	}

	count(userId: string): number {
		return this.map.get(userId)?.size ?? 0;
	}

	push(userId: string, event: string): void {
		const set = this.map.get(userId);
		if (!set) return;
		const failed: SseSubscriber[] = [];
		for (const sub of set) {
			try {
				sub.push(event);
			} catch {
				// Subscriber's writer is dead — remove so we don't hot-loop on
				// every future push.
				failed.push(sub);
			}
		}
		for (const sub of failed) set.delete(sub);
		if (set.size === 0) this.map.delete(userId);
	}

	disconnectUser(userId: string): void {
		const set = this.map.get(userId);
		if (!set) return;
		for (const sub of set) {
			try {
				sub.close();
			} catch {
				// best-effort
			}
		}
		this.map.delete(userId);
	}
}

export interface SseHandlerOptions {
	db: NotifyD1; // reserved for future Last-Event-ID replay; unused here
	registry: SseRegistry;
	auth: (req: Request) => Promise<{ userId: string } | null>;
	originAllowlist?: ReadonlyArray<string>;
	maxConnPerUser?: number;
	heartbeatMs?: number;
}

/**
 * Construct an SSE handler. `(req: Request) => Promise<Response>`. Auth is
 * **required** at construction — there is no anonymous default. Origin
 * allowlist defends against cross-origin EventSource scraping when set.
 */
export function createSseHandler(opts: SseHandlerOptions): (req: Request) => Promise<Response> {
	if (typeof opts.auth !== "function") {
		throw new Error(
			"createSseHandler({ auth }) is required — anonymous SSE subscriptions are not supported",
		);
	}
	const maxConn = Math.max(1, opts.maxConnPerUser ?? 5);
	const heartbeatMs = opts.heartbeatMs ?? 30_000;

	return async (req: Request): Promise<Response> => {
		// Origin allowlist enforcement.
		if (opts.originAllowlist) {
			const origin = req.headers.get("origin");
			if (!origin || !opts.originAllowlist.includes(origin)) {
				return new Response("forbidden origin", { status: 403 });
			}
		}

		const session = await opts.auth(req);
		if (!session) return new Response("unauthorized", { status: 401 });

		if (opts.registry.count(session.userId) >= maxConn) {
			return new Response("too many connections", { status: 429 });
		}

		const encoder = new TextEncoder();
		// Hoist subscriber + timer to outer scope so `cancel()` can run the
		// same teardown that `sub.close()` runs from the registry side. Both
		// callbacks need to remove the subscriber from the registry AND clear
		// the heartbeat interval; without that, an aborted client leaves
		// `setInterval` ticking indefinitely.
		let timer: ReturnType<typeof setInterval> | undefined;
		let sub: SseSubscriber | undefined;
		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (timer) clearInterval(timer);
			if (sub) opts.registry.remove(sub);
		};

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				sub = {
					userId: session.userId,
					push: (data: string) => {
						controller.enqueue(encoder.encode(`data: ${data}\n\n`));
					},
					close: () => {
						try {
							controller.close();
						} catch {
							// already closed
						}
						cleanup();
					},
				};
				opts.registry.add(sub);
				controller.enqueue(encoder.encode(": connected\n\n"));
				timer = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(": keepalive\n\n"));
					} catch {
						// connection went away — release resources here too
						cleanup();
					}
				}, heartbeatMs);
			},
			cancel() {
				cleanup();
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
			},
		});
	};
}
