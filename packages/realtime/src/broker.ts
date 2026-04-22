import { encodeComment, encodeEvent } from "./framing";
import { type RingBuffer, createRingBuffer } from "./ring-buffer";
import {
	type BrokerConfig,
	DEFAULT_CHANNEL_PATTERN,
	DEFAULT_HEARTBEAT_MS,
	DEFAULT_MAX_SUBSCRIBERS_PER_CHANNEL,
	DEFAULT_REPLAY_BUFFER_SIZE,
} from "./types";

interface Writer {
	write(bytes: Uint8Array): void;
}

interface BufferedEvent {
	event: string;
	data: string;
}

export interface BrokerInstance {
	fetch(request: Request): Promise<Response>;
}

export type BrokerClass<TEnv> = new (state: DurableObjectState, env: TEnv) => BrokerInstance;

export function createBroker<TEnv = unknown, TPrincipal = unknown>(
	config: BrokerConfig<TEnv, TPrincipal>,
): BrokerClass<TEnv> {
	const replayBufferSize = config.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
	const maxSubs = config.maxSubscribersPerChannel ?? DEFAULT_MAX_SUBSCRIBERS_PER_CHANNEL;
	const heartbeatMs = config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
	const channelPattern = config.channelPattern ?? DEFAULT_CHANNEL_PATTERN;

	if (!Number.isInteger(replayBufferSize) || replayBufferSize < 0) {
		throw new Error(
			`createBroker: replayBufferSize must be a non-negative integer, got ${replayBufferSize}`,
		);
	}
	if (!Number.isInteger(maxSubs) || maxSubs <= 0) {
		throw new Error(
			`createBroker: maxSubscribersPerChannel must be a positive integer, got ${maxSubs}`,
		);
	}
	if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
		throw new Error(
			`createBroker: heartbeatMs must be a positive finite number, got ${heartbeatMs}`,
		);
	}

	return class Broker implements BrokerInstance {
		private subs = new Set<Writer>();
		private buffer: RingBuffer<BufferedEvent> = createRingBuffer(replayBufferSize);

		constructor(
			readonly state: DurableObjectState,
			readonly env: TEnv,
		) {}

		async fetch(request: Request): Promise<Response> {
			const url = new URL(request.url);
			if (url.pathname === "/subscribe") {
				if (request.method !== "GET") {
					return new Response("method not allowed", { status: 405 });
				}
				return this.handleSubscribe(url, request);
			}
			if (url.pathname === "/publish") {
				if (request.method !== "POST") {
					return new Response("method not allowed", { status: 405 });
				}
				return this.handlePublish(request);
			}
			return new Response("not found", { status: 404 });
		}

		private async handleSubscribe(url: URL, request: Request): Promise<Response> {
			const channel = url.searchParams.get("channel");
			if (!channel || !channelPattern.test(channel)) {
				return new Response("invalid channel", { status: 400 });
			}

			let principal: TPrincipal | null;
			try {
				principal = await config.authorize(channel, request, this.env);
			} catch {
				// Authorize threw — treat as deny. No logging (constitution rule #7).
				return new Response("forbidden", { status: 403 });
			}
			if (principal === null) return new Response("forbidden", { status: 403 });

			if (this.subs.size >= maxSubs) {
				return new Response("too many subscribers", { status: 429 });
			}

			// Header wins over query param; strict digit regex because parseInt("500abc") is 500.
			const lastEventIdRaw =
				request.headers.get("Last-Event-ID") ?? url.searchParams.get("lastEventId");
			const lastEventId =
				lastEventIdRaw && /^\d+$/.test(lastEventIdRaw) ? Number.parseInt(lastEventIdRaw, 10) : 0;

			const subs = this.subs;
			const buffer = this.buffer;

			let timer: ReturnType<typeof setInterval> | undefined;
			let writer: Writer | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (timer) clearInterval(timer);
				if (writer) subs.delete(writer);
			};

			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					writer = {
						write: (bytes) => controller.enqueue(bytes),
					};

					// Open-ack first so the client knows the stream is alive.
					controller.enqueue(encodeComment("connected"));

					// If the client reports a higher Last-Event-ID than we have, the DO
					// evicted mid-session and our counter reset. Signal that so the
					// client can discard local state and refetch, rather than silently
					// merging a fresh id stream on top of stale state.
					if (lastEventId > buffer.lastId) {
						controller.enqueue(
							encodeEvent({
								event: "realtime.reset",
								id: buffer.lastId,
								data: JSON.stringify({ reason: "buffer_gap", lastKnownId: lastEventId }),
							}),
						);
					} else if (lastEventId < buffer.lastId) {
						// Replay missed events before live delivery.
						for (const { id, event } of buffer.since(lastEventId)) {
							controller.enqueue(encodeEvent({ event: event.event, id, data: event.data }));
						}
					}

					subs.add(writer);

					timer = setInterval(() => {
						// Guard against a timer callback scheduled before cleanup() ran.
						if (cleanedUp) return;
						try {
							controller.enqueue(encodeComment("keepalive"));
						} catch {
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
		}

		private async handlePublish(request: Request): Promise<Response> {
			let parsed: unknown;
			try {
				parsed = await request.json();
			} catch {
				return new Response("invalid json", { status: 400 });
			}
			const body = parsed as { event?: unknown; data?: unknown };
			if (typeof body.event !== "string" || body.event === "") {
				return new Response("invalid event", { status: 400 });
			}
			if (body.data === undefined) {
				return new Response("data required", { status: 400 });
			}

			const dataStr = JSON.stringify(body.data);
			const id = this.buffer.push({ event: body.event, data: dataStr });
			const bytes = encodeEvent({ event: body.event, id, data: dataStr });

			let delivered = 0;
			const failed: Writer[] = [];
			// Iterate a snapshot so heartbeat-triggered prunes in the same tick
			// don't mutate the set mid-loop.
			for (const w of [...this.subs]) {
				try {
					w.write(bytes);
					delivered += 1;
				} catch {
					failed.push(w);
				}
			}
			for (const w of failed) this.subs.delete(w);

			return new Response(JSON.stringify({ delivered, id }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
	};
}
