import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSessionDO } from "../src/session";
import type { ChatMessage } from "../src/types";

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

// --- Mock DO storage ---

function createMockStorage() {
	const data = new Map<string, unknown>();

	return {
		_data: data,
		get: vi.fn(async (key: string) => data.get(key)),
		put: vi.fn(async (key: string, value: unknown) => {
			data.set(key, value);
		}),
		delete: vi.fn(async (keys: string | string[]) => {
			const arr = Array.isArray(keys) ? keys : [keys];
			let deleted = false;
			for (const key of arr) {
				if (data.has(key)) {
					data.delete(key);
					deleted = true;
				}
			}
			return deleted;
		}),
		list: vi.fn(async (opts?: { prefix?: string }) => {
			const prefix = opts?.prefix ?? "";
			const result = new Map<string, unknown>();
			for (const [key, value] of data) {
				if (key.startsWith(prefix)) {
					result.set(key, value);
				}
			}
			return result;
		}),
	};
}

// --- Mock WebSocket ---

class MockWebSocket {
	readonly sent: string[] = [];
	private attachment: unknown = null;

	send(data: string) {
		this.sent.push(data);
	}

	serializeAttachment(value: unknown) {
		this.attachment = JSON.parse(JSON.stringify(value));
	}

	deserializeAttachment() {
		return this.attachment;
	}

	close(_code?: number, _reason?: string) {}
}

// --- Mock DurableObjectState ---

function createMockState(storage?: ReturnType<typeof createMockStorage>) {
	const mockStorage = storage ?? createMockStorage();
	const webSockets: WebSocket[] = [];

	return {
		storage: mockStorage,
		_webSockets: webSockets,
		getWebSockets: vi.fn(() => webSockets),
		acceptWebSocket: vi.fn((ws: WebSocket) => {
			webSockets.push(ws);
		}),
	};
}

// --- Mock WebSocketPair ---

function installWebSocketPairMock(): { getLastPair: () => [MockWebSocket, MockWebSocket] } {
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

	return {
		getLastPair: () => [lastClient, lastServer],
	};
}

describe("ChatSessionDO", () => {
	let mockState: ReturnType<typeof createMockState>;

	beforeEach(() => {
		mockState = createMockState();
		(globalThis as any).Response = MockResponse;
	});

	afterEach(() => {
		delete (globalThis as any).WebSocketPair;
		(globalThis as any).Response = OriginalResponse;
	});

	function createDO(onMessage?: (sessionId: string, msg: ChatMessage) => Promise<any>) {
		return new ChatSessionDO(
			mockState as any,
			{},
			{
				onMessage: onMessage ?? (async () => {}),
				maxStoredMessages: 50,
			},
		);
	}

	describe("fetch -- WebSocket upgrade", () => {
		it("should return 426 for non-WebSocket requests", async () => {
			const dobj = createDO();
			const request = new OriginalRequest("http://localhost/chat");
			const response = (await dobj.fetch(request)) as any;
			expect(response.status).toBe(426);
		});

		it("should return 101 for WebSocket upgrade requests", async () => {
			installWebSocketPairMock();
			const dobj = createDO();
			const request = new OriginalRequest("http://localhost/chat?sessionId=s1", {
				headers: { Upgrade: "websocket" },
			});

			const response = (await dobj.fetch(request)) as any;
			expect(response.status).toBe(101);
		});

		it("should accept the WebSocket on the state", async () => {
			installWebSocketPairMock();
			const dobj = createDO();
			const request = new OriginalRequest("http://localhost/chat?sessionId=s1", {
				headers: { Upgrade: "websocket" },
			});

			await dobj.fetch(request);
			expect(mockState.acceptWebSocket).toHaveBeenCalled();
		});
	});

	describe("webSocketMessage", () => {
		it("should call onMessage with decoded message", async () => {
			const onMessage = vi.fn().mockResolvedValue(undefined);
			const dobj = createDO(onMessage);

			const ws = new MockWebSocket();
			const data = JSON.stringify({
				type: "message",
				content: "Hello",
				role: "user",
			});

			await dobj.webSocketMessage(ws as any, data);

			expect(onMessage).toHaveBeenCalledTimes(1);
			const [, msg] = onMessage.mock.calls[0];
			expect(msg.type).toBe("message");
			expect(msg.content).toBe("Hello");
		});

		it("should send response messages back to the WebSocket", async () => {
			const responseMsg: ChatMessage = {
				id: "resp-1",
				type: "message",
				role: "assistant",
				content: "Reply!",
				timestamp: Date.now(),
			};
			const dobj = createDO(async () => responseMsg);

			const ws = new MockWebSocket();
			await dobj.webSocketMessage(
				ws as any,
				JSON.stringify({ type: "message", content: "Hi", role: "user" }),
			);

			const sentMessages = ws.sent.map((s) => JSON.parse(s));
			const reply = sentMessages.find((m: any) => m.id === "resp-1");
			expect(reply).toBeDefined();
			expect(reply.content).toBe("Reply!");
		});

		it("should store messages in DO storage", async () => {
			const dobj = createDO();
			const ws = new MockWebSocket();

			await dobj.webSocketMessage(
				ws as any,
				JSON.stringify({ type: "message", content: "stored msg", role: "user" }),
			);

			const stored = await mockState.storage.list({ prefix: "msg:" });
			expect(stored.size).toBeGreaterThan(0);
			const values = [...stored.values()] as ChatMessage[];
			expect(values.some((v) => v.content === "stored msg")).toBe(true);
		});

		it("should send error for invalid messages", async () => {
			const dobj = createDO();
			const ws = new MockWebSocket();

			await dobj.webSocketMessage(ws as any, "not json");

			expect(ws.sent).toHaveLength(1);
			const errorMsg = JSON.parse(ws.sent[0]);
			expect(errorMsg.type).toBe("error");
		});

		it("should send error for messages exceeding maxMessageSize", async () => {
			const dobj = new ChatSessionDO(mockState as any, {}, {
				onMessage: async () => {},
				maxMessageSize: 20,
			});
			const ws = new MockWebSocket();

			await dobj.webSocketMessage(
				ws as any,
				JSON.stringify({ type: "message", content: "A".repeat(100), role: "user" }),
			);

			expect(ws.sent).toHaveLength(1);
			const errorMsg = JSON.parse(ws.sent[0]);
			expect(errorMsg.type).toBe("error");
			expect(errorMsg.content).toContain("exceeds maximum size");
		});

		it("should send error when onMessage handler throws", async () => {
			const dobj = createDO(async () => {
				throw new Error("handler error");
			});
			const ws = new MockWebSocket();

			await dobj.webSocketMessage(
				ws as any,
				JSON.stringify({ type: "message", content: "trigger", role: "user" }),
			);

			const sentMessages = ws.sent.map((s) => JSON.parse(s));
			const errorMsg = sentMessages.find((m: any) => m.type === "error");
			expect(errorMsg).toBeDefined();
			expect(errorMsg.content).toBe("handler error");
		});
	});

	describe("webSocketClose", () => {
		it("should clean up the session from the sessions map", () => {
			const dobj = createDO();
			const ws = new MockWebSocket();

			// Directly call close — should not throw
			dobj.webSocketClose(ws as any, 1000, "normal", true);
		});
	});

	describe("webSocketError", () => {
		it("should clean up the session from the sessions map", () => {
			const dobj = createDO();
			const ws = new MockWebSocket();

			// Directly call error — should not throw
			dobj.webSocketError(ws as any, new Error("ws error"));
		});
	});

	describe("message storage and replay", () => {
		it("should prune old messages when exceeding maxStoredMessages", async () => {
			const dobj = new ChatSessionDO(mockState as any, {}, {
				onMessage: async () => {},
				maxStoredMessages: 3,
			});
			const ws = new MockWebSocket();

			// Send 5 messages
			for (let i = 0; i < 5; i++) {
				await dobj.webSocketMessage(
					ws as any,
					JSON.stringify({ type: "message", content: `msg-${i}`, role: "user" }),
				);
			}

			const stored = await mockState.storage.list({ prefix: "msg:" });
			expect(stored.size).toBeLessThanOrEqual(3);
		});

		it("should replay messages on reconnection via fetch", async () => {
			const wsHelper = installWebSocketPairMock();
			const dobj = createDO();

			// Manually insert some messages into storage
			const msg1: ChatMessage = {
				id: "m1",
				type: "message",
				role: "user",
				content: "First",
				timestamp: 1000,
			};
			const msg2: ChatMessage = {
				id: "m2",
				type: "message",
				role: "assistant",
				content: "Second",
				timestamp: 2000,
			};
			const msg3: ChatMessage = {
				id: "m3",
				type: "message",
				role: "user",
				content: "Third",
				timestamp: 3000,
			};

			await mockState.storage.put(`msg:${msg1.timestamp}:${msg1.id}`, msg1);
			await mockState.storage.put(`msg:${msg2.timestamp}:${msg2.id}`, msg2);
			await mockState.storage.put(`msg:${msg3.timestamp}:${msg3.id}`, msg3);

			// Reconnect with lastMessageId=m1 — should replay m2 and m3
			const request = new OriginalRequest(
				"http://localhost/chat?sessionId=s1&lastMessageId=m1",
				{ headers: { Upgrade: "websocket" } },
			);
			await dobj.fetch(request);

			const [, server] = wsHelper.getLastPair();
			expect(server.sent).toHaveLength(2);
			const replayed = server.sent.map((s) => JSON.parse(s));
			expect(replayed[0].id).toBe("m2");
			expect(replayed[1].id).toBe("m3");
		});

		it("should replay all messages when lastMessageId is not found", async () => {
			const wsHelper = installWebSocketPairMock();
			const dobj = createDO();

			const msg1: ChatMessage = {
				id: "m1",
				type: "message",
				role: "user",
				content: "First",
				timestamp: 1000,
			};
			await mockState.storage.put(`msg:${msg1.timestamp}:${msg1.id}`, msg1);

			const request = new OriginalRequest(
				"http://localhost/chat?sessionId=s1&lastMessageId=nonexistent",
				{ headers: { Upgrade: "websocket" } },
			);
			await dobj.fetch(request);

			const [, server] = wsHelper.getLastPair();
			expect(server.sent).toHaveLength(1);
			const replayed = JSON.parse(server.sent[0]);
			expect(replayed.id).toBe("m1");
		});
	});
});

// Helper: use the real Request constructor (not mocked)
const OriginalRequest = globalThis.Request;
