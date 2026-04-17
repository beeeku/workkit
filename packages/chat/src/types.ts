/** Discriminator for chat message types */
export type ChatMessageType =
	| "message"
	| "typing"
	| "error"
	| "tool_call"
	| "tool_result"
	| "system";

/** A fully-resolved chat message with all fields populated */
export interface ChatMessage {
	id: string;
	type: ChatMessageType;
	role: "user" | "assistant" | "system";
	content: string;
	metadata?: Record<string, unknown>;
	timestamp: number;
}

/** Options for creating a chat transport */
export interface ChatTransportOptions {
	/** Called when a message arrives on the WebSocket. Return message(s) to send back. */
	onMessage: (
		sessionId: string,
		message: ChatMessage,
	) => Promise<ChatMessage | ChatMessage[] | void>;
	/** Called when a new WebSocket connection is established */
	onConnect?: (sessionId: string) => Promise<void>;
	/** Called when a WebSocket connection closes */
	onDisconnect?: (sessionId: string) => Promise<void>;
	/** Heartbeat ping interval in milliseconds. Default: 30000 */
	heartbeatInterval?: number;
	/** Maximum incoming message size in bytes. Default: 65536 */
	maxMessageSize?: number;
}

/** Persisted state for a single chat session */
export interface SessionState {
	sessionId: string;
	connectedAt: number;
	lastMessageId?: string;
	messageCount: number;
}
