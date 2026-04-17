import { ChatError } from "./errors";
import { createMessageId, decodeMessage, encodeMessage } from "./protocol";
import type { ChatMessage, ChatTransportOptions } from "./types";

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

			server.addEventListener("message", (event: MessageEvent) => {
				void (async () => {
					const raw =
						typeof event.data === "string"
							? event.data
							: new TextDecoder().decode(event.data as ArrayBuffer);

					// Size check
					const byteLength = new TextEncoder().encode(raw).byteLength;
					if (byteLength > maxMessageSize) {
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: `Message exceeds maximum size of ${maxMessageSize} bytes`,
							timestamp: Date.now(),
						};
						server.send(encodeMessage(errorMsg));
						return;
					}

					let wire: ReturnType<typeof decodeMessage> | undefined;
					try {
						wire = decodeMessage(raw);
					} catch (err) {
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: err instanceof ChatError ? err.message : "Failed to decode message",
							timestamp: Date.now(),
						};
						server.send(encodeMessage(errorMsg));
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

					try {
						const result = await options.onMessage(sessionId, incomingMessage);
						if (result) {
							const messages = Array.isArray(result) ? result : [result];
							for (const msg of messages) {
								server.send(encodeMessage(msg));
							}
						}
					} catch (err) {
						const errorMsg: ChatMessage = {
							id: createMessageId(),
							type: "error",
							role: "system",
							content: err instanceof Error ? err.message : "Internal error processing message",
							timestamp: Date.now(),
						};
						server.send(encodeMessage(errorMsg));
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
