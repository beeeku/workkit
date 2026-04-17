import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatTransport } from "../src/transport";
import type { ChatMessage, ChatTransportOptions } from "../src/types";

// --- Mock Response that supports status 101 and webSocket property ---

const OriginalResponse = globalThis.Response;

class MockResponse {
	status: number;
	webSocket: unknown;
	body: unknown;

	constructor(body: unknown, init?: { status?: number; webSocket?: unknown }) {
		this.body = body;
		this.status = init?.status ?? 200;
		this.webSocket = init?.webSocket;
	}
}

// --- Mocks for Cloudflare WebSocketPair ---

class MockWebSocket {
	readonly sent: string[] = [];
	readonly listeners: Map<string, ((...args: any[]) => void)[]> = new Map();
	readyState = 1; // OPEN

	accept() {}

	send(data: string) {
		this.sent.push(data);
	}

	addEventListener(event: string, handler: (...args: any[]) => void) {
		const existing = this.listeners.get(event) ?? [];
		existing.push(handler);
		this.listeners.set(event, existing);
	}

	close(_code?: number, _reason?: string) {
		this.readyState = 3;
	}

	// Test helper: simulate an incoming event
	_emit(event: string, data?: unknown) {
		const handlers = this.listeners.get(event) ?? [];
		for (const handler of handlers) {
			handler(data);
		}
	}
}

function installMocks(): { getLastPair: () => [MockWebSocket, MockWebSocket] } {
	let lastClient: MockWebSocket;
	let lastServer: MockWebSocket;

	(globalThis as any).WebSocketPair = class {
		0: MockWebSocket;
		1: MockWebSocket;
		constructor() {
			lastClient = new MockWebSocket();
			lastServer = new MockWebSocket();
			this[0] = lastClient;
			this[1] = lastServer;
		}
	};

	(globalThis as any).Response = MockResponse;

	return {
		getLastPair: () => [lastClient, lastServer],
	};
}

function cleanupMocks() {
	(globalThis as any).WebSocketPair = undefined;
	(globalThis as any).Response = OriginalResponse;
}

describe("createChatTransport", () => {
	let wsHelper: ReturnType<typeof installMocks>;

	beforeEach(() => {
		vi.useFakeTimers();
		wsHelper = installMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanupMocks();
	});

	function makeOptions(overrides?: Partial<ChatTransportOptions>): ChatTransportOptions {
		return {
			onMessage: vi.fn().mockResolvedValue(undefined),
			...overrides,
		};
	}

	function dummyRequest(): Request {
		return new Request("http://localhost/ws");
	}

	it("should return a Response with status 101", () => {
		const transport = createChatTransport(makeOptions());
		const response = transport.handleUpgrade(dummyRequest(), "session-1") as any;
		expect(response.status).toBe(101);
	});

	it("should return a Response with the client WebSocket", () => {
		const transport = createChatTransport(makeOptions());
		const response = transport.handleUpgrade(dummyRequest(), "session-1") as any;
		expect(response.webSocket).toBeDefined();
	});

	it("should accept the server WebSocket", () => {
		const transport = createChatTransport(makeOptions());
		transport.handleUpgrade(dummyRequest(), "session-1");
		const [, server] = wsHelper.getLastPair();
		// accept() is called on the server side — we can verify by the fact that
		// message listeners are registered
		expect(server.listeners.has("message")).toBe(true);
	});

	it("should call onConnect when provided", async () => {
		const onConnect = vi.fn().mockResolvedValue(undefined);
		const transport = createChatTransport(makeOptions({ onConnect }));
		transport.handleUpgrade(dummyRequest(), "session-42");

		// onConnect is called asynchronously
		await vi.waitFor(() => {
			expect(onConnect).toHaveBeenCalledWith("session-42");
		});
	});

	it("should handle incoming messages and call onMessage", async () => {
		const onMessage = vi.fn().mockResolvedValue(undefined);
		const transport = createChatTransport(makeOptions({ onMessage }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		const wireMsg = JSON.stringify({
			type: "message",
			content: "Hello",
			role: "user",
		});
		server._emit("message", { data: wireMsg });

		await vi.waitFor(() => {
			expect(onMessage).toHaveBeenCalledTimes(1);
		});
		const [sessionId, msg] = onMessage.mock.calls[0];
		expect(sessionId).toBe("s1");
		expect(msg.type).toBe("message");
		expect(msg.content).toBe("Hello");
		expect(msg.role).toBe("user");
	});

	it("should send response messages back over the WebSocket", async () => {
		const responseMsg: ChatMessage = {
			id: "resp-1",
			type: "message",
			role: "assistant",
			content: "Hi there",
			timestamp: Date.now(),
		};
		const onMessage = vi.fn().mockResolvedValue(responseMsg);
		const transport = createChatTransport(makeOptions({ onMessage }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "Hello", role: "user" }),
		});

		await vi.waitFor(() => {
			expect(server.sent.length).toBeGreaterThan(0);
		});

		const sent = JSON.parse(server.sent[0]);
		expect(sent.id).toBe("resp-1");
		expect(sent.content).toBe("Hi there");
	});

	it("should send multiple response messages when onMessage returns an array", async () => {
		const responses: ChatMessage[] = [
			{
				id: "r1",
				type: "message",
				role: "assistant",
				content: "First",
				timestamp: Date.now(),
			},
			{
				id: "r2",
				type: "message",
				role: "assistant",
				content: "Second",
				timestamp: Date.now(),
			},
		];
		const onMessage = vi.fn().mockResolvedValue(responses);
		const transport = createChatTransport(makeOptions({ onMessage }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "Go", role: "user" }),
		});

		await vi.waitFor(() => {
			expect(server.sent).toHaveLength(2);
		});
		expect(JSON.parse(server.sent[0]).content).toBe("First");
		expect(JSON.parse(server.sent[1]).content).toBe("Second");
	});

	it("should send an error message when incoming message exceeds maxMessageSize", async () => {
		const transport = createChatTransport(makeOptions({ maxMessageSize: 20 }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		const bigMsg = JSON.stringify({
			type: "message",
			content: "A".repeat(100),
			role: "user",
		});
		server._emit("message", { data: bigMsg });

		await vi.waitFor(() => {
			expect(server.sent.length).toBeGreaterThan(0);
		});

		const errorResponse = JSON.parse(server.sent[0]);
		expect(errorResponse.type).toBe("error");
		expect(errorResponse.content).toContain("exceeds maximum size");
	});

	it("should send an error message for invalid JSON", async () => {
		const transport = createChatTransport(makeOptions());
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", { data: "not json" });

		await vi.waitFor(() => {
			expect(server.sent.length).toBeGreaterThan(0);
		});

		const errorResponse = JSON.parse(server.sent[0]);
		expect(errorResponse.type).toBe("error");
	});

	it("should send heartbeat pings at the configured interval", () => {
		const transport = createChatTransport(makeOptions({ heartbeatInterval: 5000 }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();

		vi.advanceTimersByTime(5000);
		expect(server.sent).toHaveLength(1);
		expect(JSON.parse(server.sent[0]).type).toBe("ping");

		vi.advanceTimersByTime(5000);
		expect(server.sent).toHaveLength(2);
	});

	it("should not send heartbeats when heartbeatInterval is 0", () => {
		const transport = createChatTransport(makeOptions({ heartbeatInterval: 0 }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();

		vi.advanceTimersByTime(60000);
		expect(server.sent).toHaveLength(0);
	});

	it("should call onDisconnect when the WebSocket closes", async () => {
		const onDisconnect = vi.fn().mockResolvedValue(undefined);
		const transport = createChatTransport(makeOptions({ onDisconnect }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		server._emit("close");

		await vi.waitFor(() => {
			expect(onDisconnect).toHaveBeenCalledWith("s1");
		});
	});

	it("should clear the heartbeat timer on close", () => {
		const transport = createChatTransport(makeOptions({ heartbeatInterval: 1000 }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();

		// Advance to get one heartbeat
		vi.advanceTimersByTime(1000);
		expect(server.sent).toHaveLength(1);

		// Close the connection
		server._emit("close");

		// Advance more — no new heartbeats should appear
		vi.advanceTimersByTime(5000);
		expect(server.sent).toHaveLength(1);
	});

	it("should send error when onMessage handler throws", async () => {
		const onMessage = vi.fn().mockRejectedValue(new Error("handler boom"));
		const transport = createChatTransport(makeOptions({ onMessage }));
		transport.handleUpgrade(dummyRequest(), "s1");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "trigger error", role: "user" }),
		});

		await vi.waitFor(() => {
			expect(server.sent.length).toBeGreaterThan(0);
		});

		const errorResponse = JSON.parse(server.sent[0]);
		expect(errorResponse.type).toBe("error");
		expect(errorResponse.content).toBe("handler boom");
	});
});
