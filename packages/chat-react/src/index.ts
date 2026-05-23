import type { ChatMessage, ChatMessageType, DebugFrame } from "@workkit/chat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type { DebugFrame, InboundFrameEvent, OutboundFrameEvent } from "@workkit/chat";

export type ChatDebugConnectionState = "connecting" | "open" | "closing" | "closed";

export interface ChatDebugSocket {
	readonly readyState: number;
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
	addEventListener(type: "open" | "close" | "error", listener: (event: Event) => void): void;
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
	removeEventListener(type: "open" | "close" | "error", listener: (event: Event) => void): void;
}

export interface UseChatDebugFramesOptions {
	/** Maximum number of frames kept in memory. Defaults to 100. */
	bufferSize?: number;
	/** Optional frame-type allowlist. Unknown/unparseable frames are filtered unless included. */
	include?: readonly (ChatMessageType | "unknown")[];
}

export interface UseChatDebugFramesResult {
	frames: readonly DebugFrame[];
	clear: () => void;
	connectionState: ChatDebugConnectionState;
}

const DEFAULT_BUFFER_SIZE = 100;
const VALID_TYPES = new Set<ChatMessageType>([
	"message",
	"typing",
	"error",
	"tool_call",
	"tool_result",
	"system",
]);
const VALID_ROLES = new Set<ChatMessage["role"]>(["user", "assistant", "system"]);
const textEncoder = new TextEncoder();

function connectionStateFromReadyState(readyState: number): ChatDebugConnectionState {
	switch (readyState) {
		case 0:
			return "connecting";
		case 1:
			return "open";
		case 2:
			return "closing";
		default:
			return "closed";
	}
}

function bytesFor(data: unknown): number {
	if (typeof data === "string") {
		return textEncoder.encode(data).byteLength;
	}
	if (data instanceof ArrayBuffer) {
		return data.byteLength;
	}
	if (ArrayBuffer.isView(data)) {
		return data.byteLength;
	}
	if (typeof Blob !== "undefined" && data instanceof Blob) {
		return data.size;
	}
	return 0;
}

function isChatMessageRole(value: unknown): value is ChatMessage["role"] {
	return typeof value === "string" && VALID_ROLES.has(value as ChatMessage["role"]);
}

function timestampFromWire(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function toMessage(data: unknown): ChatMessage | undefined {
	if (typeof data !== "string") return undefined;
	const parsed = JSON.parse(data) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Message must be a JSON object");
	}
	const wire = parsed as Record<string, unknown>;
	if (typeof wire.type !== "string" || !VALID_TYPES.has(wire.type as ChatMessageType)) {
		throw new Error(`Invalid message type: ${String(wire.type)}`);
	}
	if (typeof wire.content !== "string") {
		throw new Error("Message must have a string 'content' field");
	}
	const role = isChatMessageRole(wire.role) ? wire.role : "user";
	return {
		id: typeof wire.id === "string" ? wire.id : "",
		type: wire.type as ChatMessageType,
		role,
		content: wire.content,
		metadata:
			typeof wire.metadata === "object" && wire.metadata !== null && !Array.isArray(wire.metadata)
				? (wire.metadata as Record<string, unknown>)
				: undefined,
		timestamp: timestampFromWire(wire.timestamp),
	};
}

function makeFrame(direction: DebugFrame["direction"], data: unknown, id: string): DebugFrame {
	try {
		const message = toMessage(data);
		return {
			id,
			direction,
			type: message?.type ?? "unknown",
			timestamp: Date.now(),
			bytes: bytesFor(data),
			data,
			message,
		};
	} catch (err) {
		return {
			id,
			direction,
			type: "unknown",
			timestamp: Date.now(),
			bytes: bytesFor(data),
			data,
			error: err instanceof Error ? err : new Error(String(err)),
		};
	}
}

function sanitizeBufferSize(value: number | undefined): number {
	const candidate = value ?? DEFAULT_BUFFER_SIZE;
	return Number.isFinite(candidate) ? Math.max(1, Math.floor(candidate)) : DEFAULT_BUFFER_SIZE;
}

function appendFrame(
	frames: readonly DebugFrame[],
	frame: DebugFrame,
	bufferSize: number,
	include: ReadonlySet<ChatMessageType | "unknown"> | undefined,
): readonly DebugFrame[] {
	if (include && !include.has(frame.type)) return frames;
	const next = [...frames, frame];
	return next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
}

export function useChatDebugFrames(
	socket: ChatDebugSocket | null | undefined,
	options: UseChatDebugFramesOptions = {},
): UseChatDebugFramesResult {
	const bufferSize = sanitizeBufferSize(options.bufferSize);
	const include = useMemo(
		() => (options.include ? new Set(options.include) : undefined),
		[options.include],
	);
	const [frames, setFrames] = useState<readonly DebugFrame[]>([]);
	const [connectionState, setConnectionState] = useState<ChatDebugConnectionState>(() =>
		socket ? connectionStateFromReadyState(socket.readyState) : "closed",
	);
	const originalSendRef = useRef<ChatDebugSocket["send"] | undefined>(undefined);
	const nextFrameIdRef = useRef(0);

	const recordFrame = useCallback(
		(direction: DebugFrame["direction"], data: unknown) => {
			const frame = makeFrame(direction, data, `frame-${++nextFrameIdRef.current}`);
			setFrames((current) => appendFrame(current, frame, bufferSize, include));
		},
		[bufferSize, include],
	);

	const clear = useCallback(() => {
		setFrames([]);
	}, []);

	useEffect(() => {
		if (!socket) {
			setConnectionState("closed");
			return;
		}

		setConnectionState(connectionStateFromReadyState(socket.readyState));

		const syncConnectionState = () => {
			setConnectionState(connectionStateFromReadyState(socket.readyState));
		};
		const onMessage = (event: MessageEvent) => {
			recordFrame("in", event.data);
		};

		socket.addEventListener("message", onMessage);
		socket.addEventListener("open", syncConnectionState);
		socket.addEventListener("close", syncConnectionState);
		socket.addEventListener("error", syncConnectionState);

		const originalSend = socket.send.bind(socket);
		originalSendRef.current = originalSend;
		socket.send = ((data: Parameters<ChatDebugSocket["send"]>[0]) => {
			recordFrame("out", data);
			return originalSend(data);
		}) as ChatDebugSocket["send"];

		return () => {
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("open", syncConnectionState);
			socket.removeEventListener("close", syncConnectionState);
			socket.removeEventListener("error", syncConnectionState);
			if (originalSendRef.current) {
				socket.send = originalSendRef.current;
			}
			originalSendRef.current = undefined;
		};
	}, [recordFrame, socket]);

	return { frames, clear, connectionState };
}
