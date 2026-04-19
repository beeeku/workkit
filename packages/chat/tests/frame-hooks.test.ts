import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatTransport } from "../src/transport";
import type {
	ChatMessage,
	ChatTransportOptions,
	InboundFrameEvent,
	OutboundFrameEvent,
} from "../src/types";

// --- Reuse the Mock WebSocket / Response pattern from transport.test.ts ---

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

class MockWebSocket {
	readonly sent: string[] = [];
	readonly listeners: Map<string, ((...args: any[]) => void)[]> = new Map();
	readyState = 1; // OPEN

	/** If set, send() throws this error on each call. */
	sendShouldThrow: Error | undefined;

	accept() {}

	send(data: string) {
		if (this.sendShouldThrow) {
			throw this.sendShouldThrow;
		}
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

function dummyRequest(): Request {
	return new Request("http://localhost/ws");
}

function makeOptions(overrides?: Partial<ChatTransportOptions>): ChatTransportOptions {
	return {
		onMessage: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("chat transport frame hooks", () => {
	let wsHelper: ReturnType<typeof installMocks>;

	beforeEach(() => {
		vi.useFakeTimers();
		wsHelper = installMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanupMocks();
	});

	it("fires onFrameIn with phase 'received' + correct bytes + sessionId", async () => {
		const onFrameIn = vi.fn();
		const transport = createChatTransport(makeOptions({ onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-recv");

		const [, server] = wsHelper.getLastPair();
		const raw = JSON.stringify({ type: "message", content: "hello", role: "user" });
		server._emit("message", { data: raw });

		await vi.waitFor(() => {
			expect(onFrameIn).toHaveBeenCalled();
		});

		const expectedBytes = new TextEncoder().encode(raw).byteLength;
		const received = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "received");
		expect(received).toBeDefined();
		expect(received?.sessionId).toBe("s-recv");
		expect(received?.bytes).toBe(expectedBytes);
		expect(received?.message).toBeUndefined();
		expect(received?.error).toBeUndefined();
	});

	it("fires onFrameIn with phase 'decoded' after a successful decode, with the ChatMessage", async () => {
		const onFrameIn = vi.fn();
		const transport = createChatTransport(makeOptions({ onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-dec");

		const [, server] = wsHelper.getLastPair();
		const raw = JSON.stringify({
			type: "message",
			content: "hi",
			role: "user",
			id: "msg-42",
		});
		server._emit("message", { data: raw });

		await vi.waitFor(() => {
			const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
			expect(phases).toContain("decoded");
		});

		const decoded = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "decoded");
		expect(decoded).toBeDefined();
		expect(decoded?.sessionId).toBe("s-dec");
		expect(decoded?.message).toBeDefined();
		expect(decoded?.message?.id).toBe("msg-42");
		expect(decoded?.message?.type).toBe("message");
		expect(decoded?.message?.content).toBe("hi");
		expect(decoded?.message?.role).toBe("user");
	});

	it("fires onFrameIn with phase 'handled' after onMessage returns successfully", async () => {
		const onFrameIn = vi.fn();
		const onMessage = vi.fn().mockResolvedValue(undefined);
		const transport = createChatTransport(makeOptions({ onMessage, onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-hand");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "hey", role: "user" }),
		});

		await vi.waitFor(() => {
			const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
			expect(phases).toContain("handled");
		});

		const handled = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "handled");
		expect(handled).toBeDefined();
		expect(handled?.sessionId).toBe("s-hand");
		expect(handled?.message).toBeDefined();
		expect(handled?.error).toBeUndefined();
	});

	it("fires onFrameIn with phase 'rejected' + error when size limit is exceeded", async () => {
		const onFrameIn = vi.fn();
		const transport = createChatTransport(makeOptions({ onFrameIn, maxMessageSize: 20 }));
		transport.handleUpgrade(dummyRequest(), "s-big");

		const [, server] = wsHelper.getLastPair();
		const raw = JSON.stringify({ type: "message", content: "A".repeat(200), role: "user" });
		server._emit("message", { data: raw });

		await vi.waitFor(() => {
			const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
			expect(phases).toContain("rejected");
		});

		const rejected = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "rejected");
		expect(rejected).toBeDefined();
		expect(rejected?.sessionId).toBe("s-big");
		expect(rejected?.error).toBeInstanceOf(Error);
		expect(rejected?.error?.message).toMatch(/exceeds maximum size/i);
		expect(rejected?.message).toBeUndefined();

		// No decoded / handled phase should fire on size reject
		const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
		expect(phases).not.toContain("decoded");
		expect(phases).not.toContain("handled");
	});

	it("fires onFrameIn with phase 'rejected' + error when JSON decode fails", async () => {
		const onFrameIn = vi.fn();
		const transport = createChatTransport(makeOptions({ onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-bad");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", { data: "<<not json>>" });

		await vi.waitFor(() => {
			const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
			expect(phases).toContain("rejected");
		});

		const rejected = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "rejected");
		expect(rejected).toBeDefined();
		expect(rejected?.error).toBeInstanceOf(Error);
		expect(rejected?.message).toBeUndefined();

		const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
		expect(phases).not.toContain("decoded");
		expect(phases).not.toContain("handled");
	});

	it("fires onFrameIn with phase 'rejected' + handler error when onMessage throws", async () => {
		const onFrameIn = vi.fn();
		const handlerErr = new Error("boom-from-handler");
		const onMessage = vi.fn().mockRejectedValue(handlerErr);
		const transport = createChatTransport(makeOptions({ onMessage, onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-throw");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "go", role: "user" }),
		});

		await vi.waitFor(() => {
			const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
			expect(phases).toContain("rejected");
		});

		const rejected = onFrameIn.mock.calls
			.map((c) => c[0] as InboundFrameEvent)
			.find((evt) => evt.phase === "rejected");
		expect(rejected).toBeDefined();
		expect(rejected?.sessionId).toBe("s-throw");
		expect(rejected?.error).toBe(handlerErr);
		// message should be populated — we already decoded it before the handler ran
		expect(rejected?.message).toBeDefined();
		expect(rejected?.message?.content).toBe("go");

		// handled should NOT fire when handler throws
		const phases = onFrameIn.mock.calls.map((c) => (c[0] as InboundFrameEvent).phase);
		expect(phases).not.toContain("handled");
	});

	it("fires onFrameOut with phase 'sent' for each message returned by the handler", async () => {
		const responses: ChatMessage[] = [
			{
				id: "r1",
				type: "message",
				role: "assistant",
				content: "one",
				timestamp: Date.now(),
			},
			{
				id: "r2",
				type: "message",
				role: "assistant",
				content: "two",
				timestamp: Date.now(),
			},
		];
		const onMessage = vi.fn().mockResolvedValue(responses);
		const onFrameOut = vi.fn();
		const transport = createChatTransport(makeOptions({ onMessage, onFrameOut }));
		transport.handleUpgrade(dummyRequest(), "s-out");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "ping", role: "user" }),
		});

		await vi.waitFor(() => {
			const sent = onFrameOut.mock.calls
				.map((c) => c[0] as OutboundFrameEvent)
				.filter((e) => e.phase === "sent");
			expect(sent).toHaveLength(2);
		});

		const sent = onFrameOut.mock.calls
			.map((c) => c[0] as OutboundFrameEvent)
			.filter((e) => e.phase === "sent");
		expect(sent[0].sessionId).toBe("s-out");
		expect(sent[0].message.id).toBe("r1");
		expect(sent[0].bytes).toBe(new TextEncoder().encode(JSON.stringify(responses[0])).byteLength);
		expect(sent[1].message.id).toBe("r2");
		expect(sent[0].error).toBeUndefined();
	});

	it("does not fire onFrameOut for heartbeat pings", () => {
		const onFrameOut = vi.fn();
		const transport = createChatTransport(makeOptions({ onFrameOut, heartbeatInterval: 1000 }));
		transport.handleUpgrade(dummyRequest(), "s-hb");

		vi.advanceTimersByTime(3000);
		expect(onFrameOut).not.toHaveBeenCalled();
	});

	it("fires onFrameOut with phase 'send-failed' when server.send throws", async () => {
		const responseMsg: ChatMessage = {
			id: "r-fail",
			type: "message",
			role: "assistant",
			content: "x",
			timestamp: Date.now(),
		};
		const onMessage = vi.fn().mockResolvedValue(responseMsg);
		const onFrameOut = vi.fn();
		const transport = createChatTransport(makeOptions({ onMessage, onFrameOut }));
		transport.handleUpgrade(dummyRequest(), "s-fail");

		const [, server] = wsHelper.getLastPair();
		const sendErr = new Error("socket gone");
		server.sendShouldThrow = sendErr;

		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "trigger", role: "user" }),
		});

		await vi.waitFor(() => {
			const phases = onFrameOut.mock.calls.map((c) => (c[0] as OutboundFrameEvent).phase);
			expect(phases).toContain("send-failed");
		});

		const failed = onFrameOut.mock.calls
			.map((c) => c[0] as OutboundFrameEvent)
			.find((e) => e.phase === "send-failed");
		expect(failed).toBeDefined();
		expect(failed?.sessionId).toBe("s-fail");
		expect(failed?.message.id).toBe("r-fail");
		expect(failed?.error).toBe(sendErr);
	});

	it("does not crash when onFrameIn throws — subsequent frames still fire", async () => {
		const calls: InboundFrameEvent[] = [];
		let throwCount = 0;
		const onFrameIn = vi.fn((evt: InboundFrameEvent) => {
			calls.push(evt);
			if (evt.phase === "received") {
				throwCount++;
				throw new Error("hook-boom");
			}
		});
		const onMessage = vi.fn().mockResolvedValue(undefined);
		const transport = createChatTransport(makeOptions({ onMessage, onFrameIn }));
		transport.handleUpgrade(dummyRequest(), "s-hookthrow");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "one", role: "user" }),
		});

		await vi.waitFor(() => {
			const phases = calls.map((c) => c.phase);
			expect(phases).toContain("handled");
		});

		// Received threw, but decoded + handled still fired
		expect(throwCount).toBe(1);
		const phases = calls.map((c) => c.phase);
		expect(phases).toContain("received");
		expect(phases).toContain("decoded");
		expect(phases).toContain("handled");
	});

	it("does not crash when onFrameOut throws — handler return path completes", async () => {
		const responseMsg: ChatMessage = {
			id: "r-ok",
			type: "message",
			role: "assistant",
			content: "hi",
			timestamp: Date.now(),
		};
		const onMessage = vi.fn().mockResolvedValue(responseMsg);
		const onFrameOut = vi.fn(() => {
			throw new Error("out-hook-boom");
		});
		const transport = createChatTransport(makeOptions({ onMessage, onFrameOut }));
		transport.handleUpgrade(dummyRequest(), "s-outthrow");

		const [, server] = wsHelper.getLastPair();
		server._emit("message", {
			data: JSON.stringify({ type: "message", content: "ping", role: "user" }),
		});

		// The outbound message must still be actually sent over the wire
		// even though the hook threw.
		await vi.waitFor(() => {
			expect(server.sent.length).toBeGreaterThan(0);
		});
		const wire = JSON.parse(server.sent[0]);
		expect(wire.id).toBe("r-ok");
		expect(onFrameOut).toHaveBeenCalled();
	});
});
