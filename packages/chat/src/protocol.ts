import { ChatError } from "./errors";
import type { ChatMessage, ChatMessageType } from "./types";

const VALID_TYPES = new Set<ChatMessageType>([
	"message",
	"typing",
	"error",
	"tool_call",
	"tool_result",
	"system",
]);

/** Wire-format message as sent/received over the WebSocket */
export interface WireMessage {
	type: ChatMessageType;
	id?: string;
	content: string;
	role?: string;
	metadata?: Record<string, unknown>;
	/** Sent by the client on reconnection to request replay of missed messages */
	lastMessageId?: string;
}

/** Encode a ChatMessage to a JSON string for sending over the wire */
export function encodeMessage(msg: ChatMessage): string {
	return JSON.stringify(msg);
}

/** Decode a raw JSON string from the wire into a validated WireMessage */
export function decodeMessage(data: string): WireMessage {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		throw new ChatError("INVALID_MESSAGE", "Failed to parse message as JSON");
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ChatError("INVALID_MESSAGE", "Message must be a JSON object");
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type as ChatMessageType)) {
		throw new ChatError(
			"INVALID_MESSAGE",
			`Invalid message type: ${String(obj.type)}. Expected one of: ${[...VALID_TYPES].join(", ")}`,
		);
	}

	if (typeof obj.content !== "string") {
		throw new ChatError("INVALID_MESSAGE", "Message must have a string 'content' field");
	}

	return {
		type: obj.type as ChatMessageType,
		id: typeof obj.id === "string" ? obj.id : undefined,
		content: obj.content,
		role: typeof obj.role === "string" ? obj.role : undefined,
		metadata:
			typeof obj.metadata === "object" && obj.metadata !== null && !Array.isArray(obj.metadata)
				? (obj.metadata as Record<string, unknown>)
				: undefined,
		lastMessageId:
			typeof obj.lastMessageId === "string" ? obj.lastMessageId : undefined,
	};
}

/** Generate a unique message ID using crypto.randomUUID with a fallback */
export function createMessageId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// Fallback for environments without crypto.randomUUID
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
