import { ChatError } from "./errors";
import { createMessageId, decodeMessage, encodeMessage } from "./protocol";
import type { ChatMessage, ChatTransportOptions, SessionState } from "./types";

/** Options for configuring the ChatSessionDO */
export interface ChatSessionDOOptions {
	/** Handler called when a valid message arrives */
	onMessage: ChatTransportOptions["onMessage"];
	/** Maximum number of messages to retain in DO storage for replay. Default: 100 */
	maxStoredMessages?: number;
	/** Maximum incoming message size in bytes. Default: 65536 */
	maxMessageSize?: number;
}

/**
 * A Durable Object that manages chat sessions with WebSocket hibernation support.
 *
 * Stores messages in DO storage for reconnection replay.
 */
export class ChatSessionDO implements DurableObject {
	private sessions: Map<WebSocket, SessionState> = new Map();
	private options: ChatSessionDOOptions;

	constructor(
		private readonly state: DurableObjectState,
		_env: unknown,
		options?: ChatSessionDOOptions,
	) {
		this.options = options ?? {
			onMessage: async () => undefined,
		};

		// Restore hibernated WebSocket sessions
		for (const ws of this.state.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as SessionState | null;
			if (attachment) {
				this.sessions.set(ws, attachment);
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const sessionId = url.searchParams.get("sessionId") ?? createMessageId();
		const lastMessageId = url.searchParams.get("lastMessageId") ?? undefined;

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

		const sessionState: SessionState = {
			sessionId,
			connectedAt: Date.now(),
			messageCount: 0,
		};

		this.state.acceptWebSocket(server);
		server.serializeAttachment(sessionState);
		this.sessions.set(server, sessionState);

		// Replay missed messages if client provides lastMessageId
		if (lastMessageId) {
			await this.replayMessages(server, lastMessageId);
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const raw = typeof message === "string" ? message : new TextDecoder().decode(message);

		const maxSize = this.options.maxMessageSize ?? 65_536;
		const byteLength = new TextEncoder().encode(raw).byteLength;
		if (byteLength > maxSize) {
			const errorMsg: ChatMessage = {
				id: createMessageId(),
				type: "error",
				role: "system",
				content: `Message exceeds maximum size of ${maxSize} bytes`,
				timestamp: Date.now(),
			};
			ws.send(encodeMessage(errorMsg));
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
			ws.send(encodeMessage(errorMsg));
			return;
		}

		const session = this.sessions.get(ws);
		const sessionId = session?.sessionId ?? "unknown";

		const incomingMessage: ChatMessage = {
			id: wire.id ?? createMessageId(),
			type: wire.type,
			role: (wire.role as ChatMessage["role"]) ?? "user",
			content: wire.content,
			metadata: wire.metadata,
			timestamp: Date.now(),
		};

		// Store the incoming message
		await this.storeMessage(incomingMessage);

		// Update session state
		if (session) {
			session.lastMessageId = incomingMessage.id;
			session.messageCount++;
			ws.serializeAttachment(session);
		}

		try {
			const result = await this.options.onMessage(sessionId, incomingMessage);
			if (result) {
				const messages = Array.isArray(result) ? result : [result];
				for (const msg of messages) {
					await this.storeMessage(msg);
					ws.send(encodeMessage(msg));
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
			ws.send(encodeMessage(errorMsg));
		}
	}

	webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
		this.sessions.delete(ws);
	}

	webSocketError(ws: WebSocket, _error: unknown): void {
		this.sessions.delete(ws);
	}

	/** Store a message in DO storage for later replay */
	private async storeMessage(msg: ChatMessage): Promise<void> {
		const maxStored = this.options.maxStoredMessages ?? 100;

		// Use a timestamp-prefixed key for ordering
		const key = `msg:${msg.timestamp}:${msg.id}`;
		await this.state.storage.put(key, msg);

		// Prune old messages if over the limit
		const stored = await this.state.storage.list({ prefix: "msg:" });
		if (stored.size > maxStored) {
			const keys = [...stored.keys()].sort();
			const toDelete = keys.slice(0, stored.size - maxStored);
			await this.state.storage.delete(toDelete);
		}
	}

	/** Replay messages since a given message ID */
	private async replayMessages(ws: WebSocket, lastMessageId: string): Promise<void> {
		const stored = await this.state.storage.list<ChatMessage>({ prefix: "msg:" });
		const messages = [...stored.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, msg]) => msg);

		// Find the index of the last known message
		let startIndex = -1;
		for (let i = 0; i < messages.length; i++) {
			if (messages[i]!.id === lastMessageId) {
				startIndex = i;
				break;
			}
		}

		// Send all messages after the last known one
		const toReplay = startIndex >= 0 ? messages.slice(startIndex + 1) : messages;
		for (const msg of toReplay) {
			ws.send(encodeMessage(msg));
		}
	}
}
