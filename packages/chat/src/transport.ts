import { ChatError } from "./errors";
import { createMessageId, decodeMessage, encodeMessage } from "./protocol";
import type {
	ChatMessage,
	ChatTransportOptions,
	InboundFrameEvent,
	OutboundFrameEvent,
} from "./types";

const DEFAULT_HEARTBEAT_INTERVAL = 30_000;
const DEFAULT_MAX_MESSAGE_SIZE = 65_536;

/** A chat transport that handles WebSocket upgrades and message routing */
export interface ChatTransport {
	/**
	 * Handle a WebSocket upgrade request.
	 * Returns a 101 Switching Protocols response with the upgraded WebSocket.
	 */
	handleUpgrade(request: Request, sessionId: string): Response;
}

/**
 * Create a chat transport that manages WebSocket connections, heartbeats,
 * and message encoding/decoding.
 *
 * Uses the Cloudflare Workers WebSocketPair API.
 */
export function createChatTransport(options: ChatTransportOptions): ChatTransport {
	const heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
	const maxMessageSize = options.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;

	// Fire-and-forget hook wrappers — throwing from a hook must never crash
	// the worker or skip downstream transport work. Matches the existing
	// onConnect / onDisconnect swallow pattern.
	const fireFrameIn = (event: InboundFrameEvent): void => {
		if (!options.onFrameIn) return;
		try {
			const result = options.onFrameIn(event);
			if (result && typeof (result as Promise<void>).catch === "function") {
				(result as Promise<void>).catch(() => {
					// Swallow — observability must not crash the worker
				});
			}
		} catch {
			// Swallow — observability must not crash the worker
		}
	};
	const fireFrameOut = (event: OutboundFrameEvent): void => {
		if (!options.onFrameOut) return;
		try {
			const result = options.onFrameOut(event);
			if (result && typeof (result as Promise<void>).catch === "function") {
				(result as Promise<void>).catch(() => {
					// Swallow — observability must not crash the worker
				});
			}
		} catch {
			// Swallow — observability must not crash the worker
		}
	};

	return {
		handleUpgrade(_request: Request, sessionId: string): Response {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

			server.accept();

			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

			if (heartbeatInterval > 0) {
				heartbeatTimer = setInterval(() => {
					try {
						server.send(JSON.stringify({ type: "ping" }));
					} catch {
						// Connection already closed, clean up
						if (heartbeatTimer !== undefined) {
							clearInterval(heartbeatTimer);
							heartbeatTimer = undefined;
						}
					}
				}, heartbeatInterval);
			}

			// Notify connect
			if (options.onConnect) {
				options.onConnect(sessionId).catch(() => {
					// Swallow — connection-level errors should not crash the worker
				});
			}

			// Encodes `msg`, sends it over the server socket, and fires onFrameOut
			// in either `sent` or `send-failed` phase. Does not rethrow.
			const sendMessage = (msg: ChatMessage): void => {
				const encoded = encodeMessage(msg);
				const bytes = new TextEncoder().encode(encoded).byteLength;
				try {
					server.send(encoded);
					fireFrameOut({ sessionId, phase: "sent", bytes, message: msg });
				} catch (err) {
					fireFrameOut({
						sessionId,
						phase: "send-failed",
						bytes,
						message: msg,
						error: err instanceof Error ? err : new Error(String(err)),
					});
				}
			};

			server.addEventListener("message", (event: MessageEvent) => {
				void (async () => {
					// Measure bytes from the raw frame so the count stays accurate for
					// payloads that aren't valid UTF-8. Only decode to string when we
					// actually need a string (size check + message decode below).
					const isString = typeof event.data === "string";
					const byteLength = isString
						? new TextEncoder().encode(event.data as string).byteLength
						: (event.data as ArrayBuffer).byteLength;
					const raw = isString
						? (event.data as string)
						: new TextDecoder().decode(event.data as ArrayBuffer);

					fireFrameIn({ sessionId, phase: "received", bytes: byteLength });
					if (byteLength > maxMessageSize) {
						const sizeErr = new Error(`Message exceeds maximum size of ${maxMessageSize} bytes`);
						fireFrameIn({
							sessionId,
							phase: "rejected",
							bytes: byteLength,
							error: sizeErr,
						});
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: sizeErr.message,
							timestamp: Date.now(),
						};
						sendMessage(errorMsg);
						return;
					}

					let wire: ReturnType<typeof decodeMessage> | undefined;
					try {
						wire = decodeMessage(raw);
					} catch (err) {
						const decodeErr = err instanceof Error ? err : new Error(String(err));
						fireFrameIn({
							sessionId,
							phase: "rejected",
							bytes: byteLength,
							error: decodeErr,
						});
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: err instanceof ChatError ? err.message : "Failed to decode message",
							timestamp: Date.now(),
						};
						sendMessage(errorMsg);
						return;
					}

					// Build a full ChatMessage from the wire message
					const incomingMessage: ChatMessage = {
						id: wire.id ?? createMessageId(),
						type: wire.type,
						role: (wire.role as ChatMessage["role"]) ?? "user",
						content: wire.content,
						metadata: wire.metadata,
						timestamp: Date.now(),
					};
					fireFrameIn({
						sessionId,
						phase: "decoded",
						bytes: byteLength,
						message: incomingMessage,
					});

					try {
						const result = await options.onMessage(sessionId, incomingMessage);
						if (result) {
							const messages = Array.isArray(result) ? result : [result];
							for (const msg of messages) {
								sendMessage(msg);
							}
						}
						fireFrameIn({
							sessionId,
							phase: "handled",
							bytes: byteLength,
							message: incomingMessage,
						});
					} catch (err) {
						const handlerErr = err instanceof Error ? err : new Error(String(err));
						fireFrameIn({
							sessionId,
							phase: "rejected",
							bytes: byteLength,
							message: incomingMessage,
							error: handlerErr,
						});
						// Only echo the message back to the client when the throw was a
						// real Error (whose .message is part of the explicit contract);
						// anything else stays generic so we don't leak internals from a
						// stringified non-Error throw.
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: err instanceof Error ? err.message : "Internal error processing message",
							timestamp: Date.now(),
						};
						sendMessage(errorMsg);
					}
				})();
			});

			server.addEventListener("close", () => {
				if (heartbeatTimer !== undefined) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = undefined;
				}
				if (options.onDisconnect) {
					options.onDisconnect(sessionId).catch(() => {
						// Swallow
					});
				}
			});

			server.addEventListener("error", () => {
				if (heartbeatTimer !== undefined) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = undefined;
				}
			});

			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		},
	};
}
