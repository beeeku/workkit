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

/**
 * Event emitted on inbound frames (messages received from the client) at each
 * lifecycle phase. Hooks are fire-and-forget — throwing from `onFrameIn` will
 * not crash the worker or skip downstream phases.
 *
 * Phases:
 * - `received`  — raw frame arrived; emitted before any decode. `bytes` is the
 *                 UTF-8 byte length of the wire payload.
 * - `decoded`   — payload parsed into a `ChatMessage`; `message` is populated.
 * - `handled`   — the `onMessage` handler returned successfully; `message` is
 *                 populated, `error` is absent.
 * - `rejected`  — the frame was not successfully handled. Triggered by:
 *                 size-limit violation, decode failure, or a throw from the
 *                 `onMessage` handler. `error` is always populated. `message`
 *                 is populated only when the throw came from the handler
 *                 (i.e. decode had already succeeded).
 */
export interface InboundFrameEvent {
	sessionId: string;
	phase: "received" | "decoded" | "handled" | "rejected";
	/** UTF-8 byte length of the raw wire payload. */
	bytes: number;
	/** Present once the frame has been decoded into a `ChatMessage`. */
	message?: ChatMessage;
	/** Present on `rejected` (size reject, decode failure, or handler throw). */
	error?: Error;
}

/**
 * Event emitted on outbound frames (messages sent to the client) from the
 * transport. Heartbeat pings are not `ChatMessage`s and are intentionally not
 * surfaced on this hook.
 *
 * Phases:
 * - `sent`         — `server.send` returned without throwing for this message.
 * - `send-failed`  — `server.send` threw; `error` is populated.
 */
export interface OutboundFrameEvent {
	sessionId: string;
	phase: "sent" | "send-failed";
	/** UTF-8 byte length of the encoded wire payload. */
	bytes: number;
	message: ChatMessage;
	/** Present on `send-failed`. */
	error?: Error;
}

/** Options for creating a chat transport */
export interface ChatTransportOptions {
	/** Called when a message arrives on the WebSocket. Return message(s) to send back. */
	onMessage: (
		sessionId: string,
		message: ChatMessage,
	) => Promise<ChatMessage | ChatMessage[] | undefined>;
	/** Called when a new WebSocket connection is established */
	onConnect?: (sessionId: string) => Promise<void>;
	/** Called when a WebSocket connection closes */
	onDisconnect?: (sessionId: string) => Promise<void>;
	/** Heartbeat ping interval in milliseconds. Default: 30000 */
	heartbeatInterval?: number;
	/** Maximum incoming message size in bytes. Default: 65536 */
	maxMessageSize?: number;
	/**
	 * Transport-level observability hook fired at each phase of an inbound
	 * frame's lifecycle (`received` / `decoded` / `handled` / `rejected`).
	 * Errors thrown from this hook are swallowed and do not affect frame
	 * handling. See {@link InboundFrameEvent}.
	 */
	onFrameIn?: (event: InboundFrameEvent) => void | Promise<void>;
	/**
	 * Transport-level observability hook fired for each outbound message
	 * (not heartbeat pings). Errors thrown from this hook are swallowed and
	 * do not affect transport behaviour. See {@link OutboundFrameEvent}.
	 */
	onFrameOut?: (event: OutboundFrameEvent) => void | Promise<void>;
}

/** Persisted state for a single chat session */
export interface SessionState {
	sessionId: string;
	connectedAt: number;
	lastMessageId?: string;
	messageCount: number;
}
